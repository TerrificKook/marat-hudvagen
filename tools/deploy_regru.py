"""GitHub runner: guarded SSH delivery without secrets in command arguments/logs."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import time
import urllib.request
import zipfile

TOOLS = Path(__file__).resolve().parent


def settings(env, config):
    if env.get('REGRU_DEPLOY_ENABLED') != 'true':
        raise ValueError('Delivery flag is not true')
    if env.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('Delivery is restricted to main')
    event = env.get('GITHUB_EVENT_NAME')
    if event not in ('push', 'workflow_dispatch'):
        raise ValueError('Delivery event is not permitted')
    if event == 'push' and env.get('REGRU_AUTO_DEPLOY') != 'true':
        raise ValueError('Automatic delivery flag is not true')
    required = ['REGRU_HOST', 'REGRU_PORT', 'REGRU_USER', 'REGRU_PATH', 'SITE_URL',
                'REGRU_SSH_PRIVATE_KEY', 'REGRU_KNOWN_HOSTS', 'GITHUB_SHA']
    if any(not env.get(k) for k in required):
        raise ValueError('Required delivery setting is missing')
    if env['SITE_URL'] != config['site_url']:
        raise ValueError('SITE_URL differs from the approved domain')
    if not re.fullmatch(r'[a-zA-Z0-9.-]+', env['REGRU_HOST']) or not re.fullmatch(r'u[0-9]+', env['REGRU_USER']):
        raise ValueError('Invalid SSH host or user')
    if not re.fullmatch(r'[0-9]{1,5}', env['REGRU_PORT']) or not 1 <= int(env['REGRU_PORT']) <= 65535:
        raise ValueError('Invalid SSH port')
    root = env['REGRU_PATH']
    if not root.startswith('/') or '/..' in root or root.endswith('/') or root.split('/')[-1] not in {config['domain'], 'www.' + config['domain']}:
        raise ValueError('Invalid individual site path')
    if not re.fullmatch(r'[0-9a-f]{40}', env['GITHUB_SHA']):
        raise ValueError('Invalid source SHA')
    return dict(env)


def payload(root, sha, repo):
    if not (root / 'index.html').is_file() or not (root / 'index.html').stat().st_size:
        raise ValueError('Missing or empty public package')
    version = json.loads((root / 'version.json').read_text('utf-8'))
    if version != {'source_sha': sha, 'repository': repo}:
        raise ValueError('Package version mismatch')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(root.rglob('*')):
            if f.is_symlink():
                raise ValueError('Symlink in package')
            if f.is_file():
                info = zipfile.ZipInfo(f.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, f.read_bytes())
    return buffer.getvalue()


def verify(site_url, sha, repo):
    expected = {'source_sha': sha, 'repository': repo}
    for attempt in range(6):
        try:
            request = urllib.request.Request(site_url + 'version.json?release=' + sha,
                                            headers={'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(request, timeout=20) as r:
                if r.status == 200 and json.load(r) == expected:
                    return
        except Exception:
            pass
        if attempt < 5:
            time.sleep(5)
    raise ValueError('Public HTTPS version verification failed; accepted files remain available for the approved rollback')


def latest_main(sha, repository):
    result = subprocess.run(['git', 'ls-remote', '--exit-code',
        'https://github.com/' + repository + '.git', 'refs/heads/main'],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    tokens = result.stdout.decode('utf-8').split()
    if result.returncode or not tokens or tokens[0] != sha:
        raise ValueError('Refusing to deploy an obsolete main; use an explicitly approved manual rollback instead')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rollback-sha', default='')
    args = parser.parse_args()
    config = json.loads((TOOLS / 'public-files.json').read_text('utf-8'))
    env = settings(os.environ, config)
    sha = args.rollback_sha or env['GITHUB_SHA']
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Rollback requires the full accepted SHA')
    if args.rollback_sha and env['GITHUB_EVENT_NAME'] != 'workflow_dispatch':
        raise ValueError('Rollback is manual only')
    if not args.rollback_sha:
        latest_main(sha, config['repository'])
    body = b'' if args.rollback_sha else payload(TOOLS.parent / 'dist-regru', sha, config['repository'])
    # The fixed, owner-installed receiver cannot be replaced by a repository push.
    from pathlib import PurePosixPath
    gateway = PurePosixPath(env['REGRU_PATH']).parent.parent / '.regru-deploy' / 'receiver-v2' / 'regru_gateway.py'
    command = [config['remote_python'], '-I', str(gateway), config['domain'],
               'rollback' if args.rollback_sha else 'deploy', sha]
    with tempfile.TemporaryDirectory(prefix='regru-ssh-') as td:
        private = Path(td) / 'deploy_key'
        hosts = Path(td) / 'known_hosts'
        private.write_text(env['REGRU_SSH_PRIVATE_KEY'].rstrip() + '\n', 'utf-8')
        hosts.write_text(env['REGRU_KNOWN_HOSTS'].rstrip() + '\n', 'utf-8')
        os.chmod(private, 0o600)
        os.chmod(hosts, 0o600)
        ssh = ['ssh', '-T', '-i', str(private), '-p', env['REGRU_PORT'],
               '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
               '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + str(hosts),
               '-o', 'ConnectTimeout=20', env['REGRU_USER'] + '@' + env['REGRU_HOST'],
               ' '.join(shlex.quote(a) for a in command)]
        # Capture diagnostics; do not print command text, environment, or credentials.
        result = subprocess.run(ssh, input=body, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise ValueError('SSH delivery rejected; ' + result.stderr.decode('utf-8', errors='replace').strip()[-500:])
        verify(env['SITE_URL'], sha, config['repository'])
        # Archive rotation is permitted only after public HTTPS verification.
        command[-2] = 'finalize'
        finalized = subprocess.run(ssh[:-1] + [' '.join(shlex.quote(a) for a in command)],
                                   input=b'', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if finalized.returncode:
            raise ValueError('Public release verified, but archive finalization failed; ' +
                             finalized.stderr.decode('utf-8', errors='replace').strip()[-500:])
    print('Public HTTPS release verified: ' + sha)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(str(e), file=__import__('sys').stderr)
        __import__('sys').exit(1)

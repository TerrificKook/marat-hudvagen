"""Fixed server entry point for one site's forced SSH command (Python 3.8+).

Installed by the owner outside www. Publishing this file in GitHub does NOT
update the installed receiver or its per-site policy. Never execute client code.
"""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import sys
import tempfile
import time
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('trusted_receiver', HERE / 'regru_remote.py')
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
MAX_BYTES = 256 * 1024 * 1024
SHA = r'[0-9a-f]{40}'
MODES = {'deploy', 'rollback', 'finalize', 'status'}
EXECUTABLE_SUFFIX = re.compile(r'\.(?:php[0-9]*|phtml|pht|phar|cgi|fcgi|pl|py|sh|shtml|shtm|asp|aspx|jsp)(?:\.|$)', re.I)
SERVER_CODE = re.compile(br'<\?(?!xml(?:\s|\?))|<%', re.I)


def command(python, gateway, domain, mode, sha):
    if mode not in MODES or not re.fullmatch(SHA, sha):
        raise ValueError('Invalid delivery operation')
    return [python, '-I', str(gateway), domain, mode, sha]


def parse_forced(original, python, gateway, domain, policy=None):
    # Parsing is only comparison against a fixed argv; never passed to a shell.
    if not original or len(original) > (20000 if policy else 1024):
        raise ValueError('Only the fixed delivery protocol is allowed')
    parts = shlex.split(original)
    # Migration compatibility: recognize the EXACT previously reviewed receiver,
    # but never execute its source. The installed gateway handles the payload.
    if policy and len(parts) == 12 and parts[:2] == [python, '-c']:
        expected = [python, '-c', parts[2], parts[3], '--root', policy['root'],
                    '--domain', domain, '--repo', policy['repo'], '--sha', parts[-1]]
        if (parts == expected and parts[3] in {'deploy', 'rollback'} and re.fullmatch(SHA, parts[-1])
                and hashlib.sha256(parts[2].encode('utf-8')).hexdigest() == policy['legacy_code_sha256']):
            return parts[3], parts[-1]
        raise ValueError('Legacy command differs from the approved protocol')
    if len(parts) != 6 or parts != command(python, gateway, domain, parts[-2], parts[-1]):
        raise ValueError('Foreign destination or arbitrary command rejected')
    return parts[-2], parts[-1]


def policy_context(domain, home=None):
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', domain):
        raise ValueError('Invalid site binding')
    home = Path(home) if home is not None else Path.home()
    state = home / '.regru-deploy' / domain
    core.no_symlink(state / 'gateway-policy.json')
    policy = json.loads((state / 'gateway-policy.json').read_text('utf-8'))
    root, state = core.context(policy['root'], domain, policy['repo'], home)
    if policy['schema'] != 2 or policy['domain'] != domain:
        raise ValueError('Gateway policy mismatch')
    if policy['keep_releases'] != 5 or policy['keep_backups'] != 5 or policy['backup_days'] != 30:
        raise ValueError('Unexpected retention policy')
    if not policy['htaccess_sha256'] or any(not re.fullmatch(r'[0-9a-f]{64}', x) for x in policy['htaccess_sha256']):
        raise ValueError('Missing approved server configuration')
    if not policy['pinned'] or any(not re.fullmatch(SHA, x) for x in policy['pinned']):
        raise ValueError('Missing protected migration release')
    return root, state, policy


def validate_static(payload, policy):
    if not payload or len(payload) > MAX_BYTES:
        raise ValueError('Invalid archive size')
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        infos = z.infolist()
        if len(infos) > 10000 or sum(i.file_size for i in infos) > MAX_BYTES:
            raise ValueError('Archive limits exceeded')
        names = set()
        for info in infos:
            core.safe_name(info.filename)
            if info.is_dir() or info.filename in names:
                raise ValueError('Duplicate or directory entry')
            names.add(info.filename)
            if EXECUTABLE_SUFFIX.search(info.filename):
                raise ValueError('Executable filename rejected')
            data = z.read(info)
            # Binary image/font/PDF bytes can contain these sequences by chance.
            # Handler configuration is pinned and executable suffixes are denied.
            if Path(info.filename).suffix.lower() in {'.html', '.css', '.js', '.svg', '.json', '.xml', '.txt'} and SERVER_CODE.search(data):
                raise ValueError('Server-side code rejected')
            if info.filename == '.htaccess' and hashlib.sha256(data).hexdigest() not in policy['htaccess_sha256']:
                raise ValueError('Server configuration requires owner approval outside deployment')
        if '.htaccess' not in names:
            raise ValueError('Approved server configuration is required')


def read_record(state):
    core.no_symlink(state / 'current.json')
    record = json.loads((state / 'current.json').read_text('utf-8'))
    if not re.fullmatch(SHA, record['sha']):
        raise ValueError('Invalid current release')
    return record


def verify_disk(root, record):
    for name, digest in record['files'].items():
        core.safe_name(name)
        core.no_symlink(root / name)
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Managed files differ from the current release')


def save_json(path, obj):
    core.no_symlink(path)
    fd, temp = tempfile.mkstemp(prefix='state-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(obj, f, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, str(path))
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def zip_inventory(state, folder, pattern):
    target = state / folder
    core.no_symlink(target)
    result = []
    for p in target.iterdir():
        if not re.fullmatch(pattern, p.name):
            # An unknown path must never become a cleanup candidate.
            continue
        core.no_symlink(p)
        if not p.is_file():
            raise ValueError('Unexpected archive file type')
        result.append(p)
    return result


def retention_plan(state, policy, record, history, now=None):
    now = time.time() if now is None else now
    protected = set(policy['pinned']) | {record['sha'], record.get('previous_sha')}
    protected.discard(None)
    ordered = []
    for item in history:
        if not re.fullmatch(SHA, item):
            raise ValueError('Invalid acceptance history')
        if item in ordered:
            ordered.remove(item)
        ordered.append(item)
    keep = protected | set(ordered[-policy['keep_releases']:])
    releases = zip_inventory(state, 'releases', SHA + r'\.zip')
    existing = {p.stem: p for p in releases}
    # Fail closed before deleting anything if a protected archive is absent/bad.
    for sha in keep:
        if sha not in existing:
            raise ValueError('Protected release archive missing')
        with zipfile.ZipFile(existing[sha]) as z:
            if z.testzip() is not None:
                raise ValueError('Protected release archive is corrupt')
            if json.loads(z.read('version.json')) != {'source_sha': sha, 'repository': policy['repo']}:
                raise ValueError('Protected release identity mismatch')
    backups = sorted(zip_inventory(state, 'backups', r'[0-9]{16,22}\.zip'), key=lambda p: int(p.stem), reverse=True)
    recent = [p for p in backups if p.stat().st_mtime >= now - policy['backup_days'] * 86400]
    keep_backups = set(recent[:policy['keep_backups']])
    delete = [p for p in releases if p.stem not in keep] + [p for p in backups if p not in keep_backups]
    return {'keep_releases': sorted(keep), 'keep_backups': sorted(p.name for p in keep_backups),
            'delete': [{'path': p.relative_to(state).as_posix(), 'bytes': p.stat().st_size,
                        'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in delete]}


def execute_retention(state, plan):
    paths = []
    for item in plan['delete']:
        rel = PurePosixPath(item['path'])
        valid = len(rel.parts) == 2 and ((rel.parts[0] == 'releases' and re.fullmatch(SHA + r'\.zip', rel.parts[1])) or
                    (rel.parts[0] == 'backups' and re.fullmatch(r'[0-9]{16,22}\.zip', rel.parts[1])))
        if not valid:
            raise ValueError('Cleanup destination outside managed archives')
        p = state.joinpath(*rel.parts)
        core.no_symlink(p)
        if not p.is_file() or p.stat().st_size != item['bytes'] or hashlib.sha256(p.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Cleanup candidate changed')
        paths.append(p)
    # All paths and hashes checked before the first deletion; no recursive delete.
    for p in paths:
        p.unlink()


def operate(domain, mode, sha, payload=b'', home=None):
    if mode not in MODES or not re.fullmatch(SHA, sha):
        raise ValueError('Invalid operation')
    root, state, policy = policy_context(domain, home)
    import fcntl
    core.no_symlink(state / 'lock')
    with (state / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = read_record(state)
        verify_disk(root, record)
        if mode in {'deploy', 'rollback'}:
            if mode == 'rollback':
                archive = state / 'releases' / (sha + '.zip')
                core.no_symlink(archive)
                payload = archive.read_bytes()
            validate_static(payload, policy)
            if sha == record['sha']:
                # Retry must not replace the previous known-good version.
                archive = state / 'releases' / (sha + '.zip')
                core.no_symlink(archive)
                if archive.read_bytes() != payload:
                    raise ValueError('Immutable release collision')
            else:
                core.apply(str(root), domain, policy['repo'], sha, payload, home)
            return {'accepted': sha, 'cleanup': 'awaiting public HTTPS confirmation'}
        if sha != record['sha']:
            raise ValueError('Operation refers to a stale public release')
        core.no_symlink(state / 'accepted.json')
        history = json.loads((state / 'accepted.json').read_text('utf-8'))
        if mode == 'finalize':
            history = [x for x in history if x != sha] + [sha]
            plan = retention_plan(state, policy, record, history)
            save_json(state / 'retention-last-plan.json', plan)
            save_json(state / 'accepted.json', history)
            execute_retention(state, plan)
            return {'finalized': sha, 'deleted_archives': len(plan['delete']), 'freed_bytes': sum(x['bytes'] for x in plan['delete'])}
        plan = retention_plan(state, policy, record, history)
        return {'domain': domain, 'sha': sha, 'previous_sha': record.get('previous_sha'),
                'verified_files': len(record['files']), 'pinned': policy['pinned'], 'retention': plan,
                'archives': {name: sum(p.stat().st_size for p in (state / name).glob('*.zip')) for name in ['releases', 'backups']}}


def main():
    if len(sys.argv) not in {2, 4}:
        raise ValueError('Fixed site binding is required')
    domain = sys.argv[1]
    _, _, policy = policy_context(domain)
    if len(sys.argv) == 2:
        mode, sha = parse_forced(os.environ.get('SSH_ORIGINAL_COMMAND', ''), policy['python'], Path(__file__).resolve(), domain, policy)
    else:
        mode, sha = sys.argv[2:]
    body = sys.stdin.buffer.read(MAX_BYTES + 1) if mode == 'deploy' else b''
    print(json.dumps(operate(domain, mode, sha, body)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not echo supplied command, archive names, paths or credentials.
        print('Delivery rejected: ' + str(error)[:240], file=sys.stderr)
        sys.exit(1)

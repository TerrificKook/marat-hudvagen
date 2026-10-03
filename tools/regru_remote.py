"""Managed static releases. Compatible with the hosting account's Python 3.8.

The site marker is provisioned separately after the owner approves its exact root.
There is no command that guesses or initializes a production destination.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import time
import zipfile


def fail(message):
    raise ValueError(message)


def no_symlink(path):
    for part in [path] + list(path.parents):
        if part.is_symlink():
            fail("Unexpected symlink")


def safe_name(name):
    p = PurePosixPath(name)
    if not name or p.as_posix() != name or p.is_absolute() or '\\' in name or '..' in p.parts:
        fail("Unsafe release filename")
    # A one-component root path is the sole server-configuration exception.
    if len(p.parts) == 1 and p.parts[0] == '.htaccess':
        return p
    if any(part.startswith('.') or part in {'docs', 'notes', 'tools', 'tests',
            'research', 'output', 'node_modules', '_project_context'} for part in p.parts):
        fail("Internal or service file in release")
    if p.suffix.lower() not in {'.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg',
            '.webp', '.avif', '.ico', '.gif', '.woff', '.woff2', '.ttf', '.otf',
            '.json', '.xml', '.pdf', '.mp4', '.webm', '.txt'}:
        fail("Unapproved file type")
    return p


def context(root_text, domain, repo, home=None):
    if not root_text or not re.fullmatch(r'[a-z0-9.-]+', domain):
        fail("Empty path or invalid domain")
    home = Path(home) if home is not None else Path.home()
    root = Path(root_text)
    if not root.is_absolute() or root.parent != home / 'www' or root.name not in {domain, 'www.' + domain}:
        fail("Destination is not an approved individual site root")
    no_symlink(root)
    if not root.is_dir():
        fail("Site root does not exist")
    state = home / '.regru-deploy' / domain
    no_symlink(state)
    marker = json.loads((state / 'site.json').read_text('utf-8'))
    if marker != {'schema': 1, 'domain': domain, 'repo': repo, 'root': str(root)}:
        fail("Site marker mismatch")
    return root, state


def unpack(payload, stage, sha, repo):
    if not re.fullmatch(r'[0-9a-f]{40}', sha) or not payload or len(payload) > 256 * 1024 * 1024:
        fail("Missing/invalid release")
    files = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        if sum(i.file_size for i in z.infolist()) > 256 * 1024 * 1024:
            fail("Release too large")
        for info in z.infolist():
            if info.is_dir() or info.filename in files:
                fail("Duplicate or non-file archive entry")
            p = safe_name(info.filename)
            if stat.S_ISLNK(info.external_attr >> 16):
                fail("Symlink archive entry")
            target = stage.joinpath(*p.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            data = z.read(info)
            target.write_bytes(data)
            files[info.filename] = hashlib.sha256(data).hexdigest()
    if not files.get('index.html') or (stage / 'index.html').stat().st_size == 0:
        fail("Missing or empty index.html")
    version = json.loads((stage / 'version.json').read_text('utf-8'))
    if version != {'source_sha': sha, 'repository': repo}:
        fail("Public version does not match release")
    return files


def atomic_file(source, dest):
    no_symlink(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='regru-', dir=str(dest.parent))
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(source.read_bytes())
        os.chmod(tmp, 0o644)
        os.replace(tmp, str(dest))
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def apply(root_text, domain, repo, sha, payload, home=None):
    root, state = context(root_text, domain, repo, home)
    current_path = state / 'current.json'
    current = json.loads(current_path.read_text('utf-8')) if current_path.exists() else {'sha': None, 'files': {}}
    previous = current['files']
    for name in previous:
        safe_name(name)
        no_symlink(root / name)
    with tempfile.TemporaryDirectory(prefix='stage-', dir=str(state)) as td:
        stage = Path(td)
        files = unpack(payload, stage, sha, repo)
        for name in files:
            target = root / name
            no_symlink(target)
            if target.exists() and (name not in previous or not target.is_file()):
                fail("Refusing to overwrite an unmanaged existing file")
        releases = state / 'releases'
        no_symlink(releases)
        releases.mkdir(exist_ok=True)
        archive = releases / (sha + '.zip')
        no_symlink(archive)
        if archive.exists() and archive.read_bytes() != payload:
            fail("Immutable release collision")
        archive.write_bytes(payload)
        backups = state / 'backups'
        no_symlink(backups)
        backups.mkdir(exist_ok=True)
        backup = backups / (str(time.time_ns()) + '.zip')
        with zipfile.ZipFile(backup, 'w', zipfile.ZIP_DEFLATED) as z:
            for name in previous:
                target = root / name
                if not target.is_file():
                    fail("Managed file missing before backup")
                z.write(target, name)
        # Per-file replacement is controlled, but is not globally atomic.
        touched = set()
        try:
            for name in sorted(files, key=lambda n: (n in {'index.html', 'version.json'}, n)):
                touched.add(name)
                atomic_file(stage / name, root / name)
            for name in set(previous) - set(files):
                no_symlink(root / name)
                (root / name).unlink()
                touched.add(name)
            for name, digest in files.items():
                if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
                    fail("Destination verification failed")
            record = stage / 'current.json'
            record.write_text(json.dumps({'sha': sha, 'files': files, 'previous_sha': current['sha']}), 'utf-8')
            atomic_file(record, current_path)
        except Exception:
            with zipfile.ZipFile(backup) as z:
                for name in touched:
                    target = root / name
                    no_symlink(target)
                    if name in previous:
                        restored = stage / 'restore' / name
                        restored.parent.mkdir(parents=True, exist_ok=True)
                        restored.write_bytes(z.read(name))
                        atomic_file(restored, target)
                    elif target.is_file():
                        target.unlink()
            raise
    return sha


def main():
    p = argparse.ArgumentParser()
    p.add_argument('mode', choices=['deploy', 'rollback'])
    for arg in ('root', 'domain', 'repo', 'sha'):
        p.add_argument('--' + arg, required=True)
    a = p.parse_args()
    root, state = context(a.root, a.domain, a.repo)
    lock = open(state / 'lock', 'a')
    import fcntl
    fcntl.flock(lock, fcntl.LOCK_EX)
    if not re.fullmatch(r'[0-9a-f]{40}', a.sha):
        fail("Invalid SHA")
    payload = (state / 'releases' / (a.sha + '.zip')).read_bytes() if a.mode == 'rollback' else sys.stdin.buffer.read(256 * 1024 * 1024 + 1)
    print('Accepted release ' + apply(a.root, a.domain, a.repo, a.sha, payload))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('Release rejected: ' + str(e), file=sys.stderr)
        sys.exit(1)

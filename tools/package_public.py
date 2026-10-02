"""Build a public-only static website directory. Python 3.10+."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from regru_remote import safe_name

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / 'tools/public-files.json').read_text('utf-8'))
source = ROOT / config['source']
dest = ROOT / 'dist-regru'
if not source.is_dir() or not (source / 'index.html').is_file():
    raise SystemExit('Missing public index.html; build the site first.')
if dest.is_symlink():
    raise SystemExit('Refusing a symlink output directory.')
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir()
allowed = {'.html', '.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif',
           '.ico', '.gif', '.woff', '.woff2', '.ttf', '.otf', '.json', '.xml', '.pdf',
           '.mp4', '.webm', '.txt'}


def copy_file(f):
    rel = f.relative_to(source)
    if f.is_symlink():
        raise SystemExit('Refusing symlink: ' + str(rel))
    if any(p.startswith('.') or p in {'node_modules', 'docs', 'notes', 'tools', 'tests',
            'output', 'research', '_project_context', '__pycache__'} for p in rel.parts):
        return
    if f.suffix.lower() not in allowed:
        return
    safe_name(rel.as_posix())
    target = dest / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(f, target)


if config['source'] == 'public':
    for f in source.rglob('*'):
        if f.is_file():
            copy_file(f)
else:
    for name in config['root_files']:
        if not (source / name).is_file():
            raise SystemExit('Missing explicit public file: ' + name)
        copy_file(source / name)
    for name in config['dirs']:
        folder = source / name
        if not folder.is_dir():
            raise SystemExit('Missing public directory: ' + name)
        for f in folder.rglob('*'):
            if f.is_file():
                copy_file(f)
sha = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', '-c', 'safe.directory=' + str(ROOT), '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
if not re.fullmatch(r'[0-9a-f]{40}', sha):
    raise SystemExit('Invalid source SHA')
(dest / 'version.json').write_text(json.dumps({'source_sha': sha, 'repository': config['repository']}) + '\n', 'utf-8')
files = [f for f in dest.rglob('*') if f.is_file()]
if not (dest / 'index.html').is_file():
    raise SystemExit('Public package has no index.html')
print(json.dumps({'files': len(files), 'bytes': sum(f.stat().st_size for f in files)}))

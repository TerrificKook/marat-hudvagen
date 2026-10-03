"""Validate the Linux file names and public-only package before delivery."""
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

from regru_remote import safe_name

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / 'tools/public-files.json').read_text('utf-8'))
out = ROOT / 'dist-regru'
files = {f.relative_to(out).as_posix() for f in out.rglob('*') if f.is_file()}
errors = []
refs = []


class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for key in ('src', 'href', 'poster', 'data-src'):
            if a.get(key):
                self.refs.append(a[key])
        for item in a.get('srcset', '').split(','):
            if item.strip():
                self.refs.append(item.strip().split()[0])


if 'index.html' not in files or not (out / 'index.html').stat().st_size:
    raise SystemExit('Missing/empty package index.html')
for rel in sorted(files):
    safe_name(rel)
    f = out / rel
    if f.is_symlink():
        errors.append(rel + ': symlink')
    if f.suffix == '.html':
        parser = Links()
        parser.refs = []
        parser.feed(f.read_text('utf-8'))
        refs.extend((rel, r) for r in parser.refs)
    if f.suffix == '.css':
        refs.extend((rel, r) for r in re.findall(r'url\([\s"\x27]*(.*?)[\s"\x27]*\)', f.read_text('utf-8')))
if 'sitemap.xml' in files:
    refs.extend(('index.html', n.text) for n in ET.parse(out / 'sitemap.xml').iter() if n.tag.endswith('loc'))
for parent, ref in refs:
    u = urlsplit(ref)
    if u.scheme not in ('', 'http', 'https') or (u.netloc and u.hostname not in {config['domain'], 'www.' + config['domain']}):
        continue
    if not u.path:
        continue
    path = unquote(u.path)
    target = out / path.lstrip('/') if path.startswith('/') or u.netloc else out / PurePosixPath(parent).parent / path
    target = target.resolve()
    if not target.is_relative_to(out.resolve()):
        errors.append(parent + ': outside package ' + ref)
        continue
    rel = target.relative_to(out.resolve()).as_posix()
    if target.is_dir():
        rel = (PurePosixPath(rel) / 'index.html').as_posix()
    # A string set catches Linux case errors even when checking on Windows.
    if rel not in files:
        errors.append(parent + ': missing/case mismatch ' + ref)
if config['domain'] == 'hudwagen.ru':
    for rel in files:
        if rel.startswith('concepts/') and rel.endswith('.html') or rel in {'site-final/index.html', 'site-final/brief.html'}:
            if 'noindex' not in (out / rel).read_text('utf-8'):
                errors.append(rel + ': archive needs noindex')
version = json.loads((out / 'version.json').read_text('utf-8'))
if version.get('repository') != config['repository'] or not re.fullmatch(r'[0-9a-f]{40}', version.get('source_sha', '')):
    errors.append('Version marker mismatch')
print(json.dumps({'files': len(files), 'references': len(refs), 'errors': errors}, ensure_ascii=False))
if errors:
    raise SystemExit(1)

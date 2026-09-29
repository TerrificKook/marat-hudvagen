"""Build a public-only static website directory for hosting. Python 3.10+."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / "tools/public-files.json").read_text(encoding="utf-8"))
source = ROOT / config["source"]
dest = ROOT / "dist-regru"
if not source.is_dir() or not (source / "index.html").is_file():
    raise SystemExit("Missing public index.html; build the site first.")
if dest.is_symlink():
    raise SystemExit("Refusing to replace a symlink output directory.")
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir()
allowed = {".html", ".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".ico", ".gif", ".woff", ".woff2", ".ttf", ".otf", ".json", ".xml", ".pdf", ".mp4", ".webm", ".txt"}
def copy_file(f):
    rel = f.relative_to(source)
    if f.is_symlink():
        raise SystemExit(f"Refusing symlink: {rel}")
    if any(part.startswith(".") or part in {"node_modules", "docs", "notes", "tools", "_project_context", "__pycache__"} for part in rel.parts):
        return
    if f.suffix.lower() not in allowed:
        return
    target = dest / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(f, target)
if config["source"] == "public":
    for f in source.rglob("*"):
        if f.is_file():
            copy_file(f)
else:
    for f in source.iterdir():
        if f.is_file() and (f.suffix.lower() in {".html", ".svg", ".png", ".jpg", ".jpeg", ".ico", ".webp"} or f.name in {"robots.txt", "sitemap.xml"}):
            copy_file(f)
    for name in config["dirs"]:
        folder = source / name
        if folder.exists():
            for f in folder.rglob("*"):
                if f.is_file():
                    copy_file(f)
files = [f for f in dest.rglob("*") if f.is_file()]
if not (dest / "index.html").exists():
    raise SystemExit("Public package has no index.html.")
print(json.dumps({"directory": str(dest), "files": len(files), "bytes": sum(f.stat().st_size for f in files)}, ensure_ascii=False))

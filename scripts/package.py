from pathlib import Path
import json
import re
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
# Check current version labels before creating an immutable release ZIP.
version_labels = {
    "popup.html": rf'<footer>버전 <span id="version">{re.escape(version)}</span>',
    "popup.js": rf"getManifest.*?\.version\|\|'{re.escape(version)}'",
    "welcome.html": rf'나이스 교외체험학습 알림 · {re.escape(version)}(?=<)',
    "privacy.html": rf'나이스 교외체험학습 알림 · {re.escape(version)}(?=<)',
    "README.md": rf'현재 버전은 \*\*{re.escape(version)}\*\*',
    "CHANGELOG.md": rf'\A# {re.escape(version)} —',
}
for name, pattern in version_labels.items():
    text = (root / name).read_text(encoding="utf-8")
    if not re.search(pattern, text):
        raise SystemExit(f"Version label mismatch in {name}: expected {version}.")
privacy = (root / "privacy.html").read_text(encoding="utf-8")
if not re.search(rf'버전 {re.escape(version)}(?=<)', privacy):
    raise SystemExit(f"Version label mismatch in privacy.html policy label: expected {version}.")
out = root / "dist"
out.mkdir(exist_ok=True)
target = out / f"neis-fieldtrip-alert-v{manifest['version']}-webstore.zip"
files = [file for file in sorted(root.iterdir())
         if file.is_file() and (file.suffix in {".js", ".json", ".html", ".css", ".png"}
                               or file.name == "THIRD_PARTY_NOTICES.txt")]
if target.exists():
    with ZipFile(target) as archive:
        identical = (sorted(archive.namelist()) == sorted(file.name for file in files)
                     and all(archive.read(file.name) == file.read_bytes() for file in files))
    if not identical:
        raise SystemExit("Refusing to overwrite a different release. Increase manifest.json version first.")
else:
    with ZipFile(target, "x", ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.name)
with ZipFile(target) as archive:
    assert "manifest.json" in archive.namelist()
    assert "THIRD_PARTY_NOTICES.txt" in archive.namelist()
    for name in archive.namelist():
        assert archive.read(name) == (root / name).read_bytes()
print(target)

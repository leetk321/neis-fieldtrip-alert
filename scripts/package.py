from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
out = root / "dist"
out.mkdir(exist_ok=True)
target = out / f"neis-fieldtrip-alert-v{manifest['version']}-webstore.zip"
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for file in sorted(root.iterdir()):
        if file.is_file() and (file.suffix in {".js", ".json", ".html", ".css", ".png"} or file.name == "THIRD_PARTY_NOTICES.txt"):
            archive.write(file, file.name)
with ZipFile(target) as archive:
    assert "manifest.json" in archive.namelist()
    assert "THIRD_PARTY_NOTICES.txt" in archive.namelist()
    for name in archive.namelist():
        assert archive.read(name) == (root / name).read_bytes()
print(target)

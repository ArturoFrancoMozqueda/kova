"""Record the actual compiled OCR artifact and its complete source-file mapping."""

import hashlib
import json
from pathlib import Path

prefix = Path("/install")
metadata = Path("/usr/local/share/kova-parser")
manifest = json.loads((prefix / metadata.relative_to("/") / "upstream-security.json").read_text())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


source_files = {}
for item in manifest["advisories"]:
    actual = digest(Path("/source") / item["source_file"])
    if actual != item["source_sha256"]:
        raise ValueError("The compiled OCR source differs from its reviewed advisory mapping")
    source_files[item["source_file"]] = actual
model_path = "/usr/local/share/tessdata/spa.traineddata"
model = prefix / model_path.lstrip("/")
if digest(model) != manifest["model"]["sha256"] or model.stat().st_mode & 0o444 != 0o444:
    raise ValueError("The fixed Spanish model must be authentic and readable by the parser user")
binary_path = "/usr/local/bin/tesseract"
attestation = {
    "source": {"commit": manifest["source"]["commit"],
               "sha256": manifest["source"]["sha256"], "files": source_files},
    "binary": {"path": binary_path, "sha256": digest(prefix / binary_path.lstrip("/"))},
    "model": {"path": model_path, "sha256": digest(model)},
}
(prefix / metadata.relative_to("/") / "tesseract-build.json").write_text(
    json.dumps(attestation, indent=2) + "\n")

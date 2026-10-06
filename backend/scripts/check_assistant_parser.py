"""Real isolated-parser smoke gate. Uses only generated, non-customer test files."""

import base64
import io
import json
import subprocess
import zipfile


def package(parts):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def check(name, content, suffix, *, accepted):
    payload = json.dumps({"content": base64.b64encode(content).decode(), "suffix": suffix})
    result = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--memory",
            "4g",
            "--cpus",
            "1",
            "--pids-limit",
            "64",
            "--tmpfs",
            "/tmp:size=256m,mode=1777",
            "-i",
            "kova-assistant-parser:1",
        ],
        input=payload.encode(),
        capture_output=True,
        timeout=600,
        check=False,
    )
    body = json.loads(result.stdout)
    if accepted:
        assert result.returncode == 0 and not body.get("error"), name
        assert "Horario" in " ".join(body["pages"]) and not body["ocr"], name
    else:
        assert result.returncode != 0 and body == {"error": "file_rejected"}, name
    print(f"PASS: {name}", flush=True)


def main():
    document = (
        b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        b"<w:body><w:p><w:r><w:t>Horario de atencion</w:t></w:r></w:p></w:body></w:document>"
    )
    check(
        "UTF-8 business text",
        "Horario: lunes a viernes. Información del negocio.".encode(),
        ".txt",
        accepted=True,
    )
    check("DOCX text", package({"word/document.xml": document}), ".docx", accepted=True)
    check(
        "DOCX path traversal",
        package({"word/document.xml": document, "../escape.txt": b"reject"}),
        ".docx",
        accepted=False,
    )
    check(
        "DOCX external relationship",
        package(
            {
                "word/document.xml": document,
                "word/_rels/document.xml.rels": b'<Relationship TargetMode="External" Target="https://example.com"/>',
            }
        ),
        ".docx",
        accepted=False,
    )
    check(
        "DOCX macro",
        package({"word/document.xml": document, "word/vbaProject.bin": b"reject"}),
        ".docx",
        accepted=False,
    )
    check(
        "DOCX expanded part",
        package({"word/document.xml": document, "word/large.txt": b"x" * (9 * 1024 * 1024)}),
        ".docx",
        accepted=False,
    )
    check("malformed PDF", b"not a PDF", ".pdf", accepted=False)
    # Standard harmless EICAR antivirus test string, never executed.
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    check("antivirus EICAR", eicar, ".txt", accepted=False)


if __name__ == "__main__":
    main()

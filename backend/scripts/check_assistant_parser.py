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


def pdf_document(image=None):
    resources = b"/Font << /F1 5 0 R >>" if image is None else b"/XObject << /Im0 5 0 R >>"
    stream = (b"BT /F1 24 Tf 35 100 Td (Horario de atencion: lunes a viernes) Tj ET"
              if image is None else b"q 600 0 0 200 0 0 cm /Im0 Do Q")
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << "
               + resources + b" >> /Contents 4 0 R >>",
               b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n"
               + stream + b"\nendstream", image or
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    data, offsets = bytearray(b"%PDF-1.4\n"), [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(data)
    data.extend(b"xref\n0 6\n0000000000 65535 f \n")
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(data)


def check(name, content, suffix, *, accepted, ocr=False):
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
        assert "Horario" in " ".join(body["pages"]) and body["ocr"] is ocr, name
    else:
        assert result.returncode != 0 and body == {"error": "file_rejected"}, name
    print(f"PASS: {name}", flush=True)


def main():
    from assistant_parser_samples import SCAN_HEIGHT, SCAN_RGB_FLATE, SCAN_WIDTH

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
    check("PDF text", pdf_document(), ".pdf", accepted=True)
    image = (f"<< /Type /XObject /Subtype /Image /Width {SCAN_WIDTH} /Height {SCAN_HEIGHT} "
             f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
             f"/Length {len(SCAN_RGB_FLATE)} >>\nstream\n").encode()
    image += SCAN_RGB_FLATE + b"\nendstream"
    check("PDF Spanish OCR", pdf_document(image), ".pdf", accepted=True, ocr=True)
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

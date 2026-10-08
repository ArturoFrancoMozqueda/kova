"""Runs ONLY inside the networkless read-only parser container, with no Kova imports."""

import base64
import io
import json
import os
import resource
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import PurePosixPath

from defusedxml import ElementTree
from pypdf import PdfReader


def parse(content, suffix):
    started = time.monotonic()
    with tempfile.TemporaryDirectory() as temp:
        path = os.path.join(temp, "input" + suffix)
        with open(path, "wb") as out:
            out.write(content)
        scan = subprocess.run(["clamscan", "--no-summary", path], capture_output=True, timeout=60)
        if scan.returncode != 0:
            raise ValueError("scanner_rejected_or_unavailable")
        pages = []
        ocr = False
        if suffix in {".txt", ".md"}:
            pages = [content.decode("utf-8-sig")]
        elif suffix == ".docx":
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > 128 or sum(e.file_size for e in entries) > 32 * 1024 * 1024:
                    raise ValueError("expanded_size")
                for entry in entries:
                    name = PurePosixPath(entry.filename)
                    if (
                        name.is_absolute()
                        or ".." in name.parts
                        or entry.file_size > 8 * 1024 * 1024
                    ):
                        raise ValueError("unsafe_package")
                    if (
                        "vbaProject" in entry.filename
                        or entry.filename.endswith(".rels")
                        and b'TargetMode="External"' in archive.read(entry)
                    ):
                        raise ValueError("external_or_macro")
                root = ElementTree.fromstring(archive.read("word/document.xml"))
                pages = [" ".join(e.text or "" for e in root.iter() if e.tag.endswith("}t"))]
        elif suffix == ".pdf":
            reader = PdfReader(io.BytesIO(content), strict=True)
            if reader.is_encrypted or len(reader.pages) > 200:
                raise ValueError("encrypted_or_page_limit")
            for index, page in enumerate(reader.pages):
                if time.monotonic() - started > 590:
                    raise ValueError("time_limit")
                text = page.extract_text() or ""
                if not text.strip():
                    ocr = True
                    prefix = os.path.join(temp, "page")
                    subprocess.run(
                        [
                            "pdftoppm",
                            "-f",
                            str(index + 1),
                            "-l",
                            str(index + 1),
                            "-r",
                            "120",
                            "-singlefile",
                            "-png",
                            path,
                            prefix,
                        ],
                        check=True,
                        capture_output=True,
                        timeout=30,
                    )
                    result = subprocess.run(
                        ["tesseract", prefix + ".png", "stdout", "-l", "spa"],
                        check=True,
                        capture_output=True,
                        timeout=30,
                    )
                    text = result.stdout.decode("utf-8")
                    os.unlink(prefix + ".png")
                pages.append(text)
        else:
            raise ValueError("format")
        if not "".join(pages).strip() or sum(len(p) for p in pages) > 2_000_000:
            raise ValueError("empty_or_text_limit")
        return {"pages": pages, "ocr": ocr}


if __name__ == "__main__":
    try:
        # Bound a malicious extraction even if the parent/daemon becomes
        # unavailable before it can remove a timed-out container.
        resource.setrlimit(resource.RLIMIT_CPU, (580, 590))
        raw = sys.stdin.buffer.read(28 * 1024 * 1024 + 1)
        if len(raw) > 28 * 1024 * 1024:
            raise ValueError("size")
        body = json.loads(raw)
        content = base64.b64decode(body["content"], validate=True)
        if len(content) > 20 * 1024 * 1024:
            raise ValueError("size")
        result = parse(content, body["suffix"])
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except Exception:
        sys.stdout.write('{"error":"file_rejected"}')
        sys.exit(1)

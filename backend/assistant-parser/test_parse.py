import os
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import parse as parser


class SpanishOcrPathTest(unittest.TestCase):
    def run_ocr(self, *, rejected=False):
        calls = []

        def run(command, **kwargs):
            calls.append((command, kwargs))
            if command[0] == "pdftoppm":
                Path(command[-1] + ".png").write_bytes(b"generated-page")
            if command[0] == "tesseract" and rejected:
                raise subprocess.CalledProcessError(1, command)
            return SimpleNamespace(returncode=0, stdout="Horario de atención".encode())

        page = SimpleNamespace(extract_text=lambda: "")
        document = SimpleNamespace(is_encrypted=False, pages=[page])
        with patch.object(parser, "PdfReader", return_value=document), \
             patch.object(parser.subprocess, "run", side_effect=run), \
             patch.dict(os.environ, {"TESSDATA_PREFIX": "/untrusted"}):
            result = parser.parse(b"generated-PDF", ".pdf")
        return result, calls

    def test_uses_only_pinned_spanish_model_directory(self):
        result, calls = self.run_ocr()
        self.assertEqual(result, {"pages": ["Horario de atención"], "ocr": True})
        self.assertEqual([command[0] for command, _ in calls],
                         ["clamscan", "pdftoppm", "tesseract"])
        command, options = calls[-1]
        self.assertEqual(command[2:], ["stdout", "--tessdata-dir",
                                     "/usr/local/share/tessdata", "-l", "spa"])
        self.assertEqual(options, {"check": True, "capture_output": True, "timeout": 30})

    def test_ocr_failure_is_rejected_without_directory_fallback(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_ocr(rejected=True)


if __name__ == "__main__":
    unittest.main()

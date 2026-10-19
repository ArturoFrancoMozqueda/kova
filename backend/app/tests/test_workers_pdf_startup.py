"""Fiscal PDF code stays available without loading its parser at API startup."""

import subprocess
import sys
from pathlib import Path


def test_workers_canvas_loads_pypdf_only_when_a_document_is_created():
    script = '''
import importlib.abc
import sys

class BlockPdf(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "pypdf" or fullname.startswith("pypdf."):
            raise AssertionError("PDF library loaded during API startup")

sys.meta_path.insert(0, BlockPdf())
from app.workers.pdf import LETTER, canvas
assert LETTER == (612, 792)
assert callable(canvas.Canvas)
assert "pypdf" not in sys.modules
'''
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr

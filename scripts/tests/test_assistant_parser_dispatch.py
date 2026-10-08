"""Selection changes scheduling only; the original ten parser oracles stay intact."""

import importlib.util
import io
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "parser_gate", ROOT / "backend/scripts/check_assistant_parser.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ParserDispatchTests(unittest.TestCase):
    def test_generated_docx_metadata_is_independent_of_wall_clock(self):
        parts = {"word/document.xml": b"same document", "../escape.txt": b"reject"}
        with patch.object(module.zipfile.time, "time", return_value=946684800):
            earlier = module.package(parts)
        with patch.object(module.zipfile.time, "time", return_value=1893456000):
            later = module.package(parts)
        self.assertEqual(earlier, later)
        with zipfile.ZipFile(io.BytesIO(later)) as archive:
            self.assertEqual(archive.namelist(), list(parts))
            for name, content in parts.items():
                self.assertEqual(archive.read(name), content)
                self.assertEqual(archive.getinfo(name).compress_type, zipfile.ZIP_DEFLATED)

    def test_default_runs_all_original_cases_and_individual_runs_partition_them(self):
        with patch.object(sys, "path", [str(ROOT / "backend/scripts"), *sys.path]):
            with patch.object(module, "check_file") as full:
                module.main()
            self.assertEqual(len(full.call_args_list), 10)
            self.assertEqual({c.args[0] for c in full.call_args_list}, set(module.CHECKS))
            selected = []
            for name in module.CHECKS:
                with patch.object(module, "check_file") as one:
                    module.main(name)
                self.assertEqual(len(one.call_args_list), 1)
                selected.extend(one.call_args_list)
            self.assertCountEqual(selected, full.call_args_list)

    def test_unknown_selection_fails_before_any_parser_execution(self):
        with patch.object(module, "check_file") as run, self.assertRaises(ValueError):
            module.main("unrecognized")
        run.assert_not_called()

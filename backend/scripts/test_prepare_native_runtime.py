import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SPEC = importlib.util.spec_from_file_location(
    "prepare_native_runtime", Path(__file__).with_name("prepare_native_runtime.py")
)
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class RuntimeAssemblyTests(unittest.TestCase):
    def test_library_copy_preserves_real_bytes_and_relative_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source/libtest.so.1.2"
            source.parent.mkdir()
            source.write_bytes(b"actual ELF bytes")
            alias = source.with_name("libtest.so.1")
            alias.symlink_to(source.name)
            root = Path(directory) / "runtime"
            RUNTIME.copy_file(source, root)
            RUNTIME.copy_file(alias, root)
            copied_alias = root / alias.relative_to("/")
            self.assertTrue(copied_alias.is_symlink())
            self.assertEqual(copied_alias.readlink(), Path(source.name))
            self.assertEqual(copied_alias.read_bytes(), source.read_bytes())

    def test_unresolved_elf_dependency_blocks_runtime_assembly(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            RUNTIME.subprocess, "run"
        ) as run:
            run.return_value = subprocess.CompletedProcess(
                [], 0, stdout="libcritical.so.1 => not found\n"
            )
            with self.assertRaisesRegex(RuntimeError, "unresolved ELF"):
                RUNTIME.required_packages(Path(directory))

    def test_unknown_library_owner_cannot_be_copied_without_metadata(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            RUNTIME.subprocess, "run"
        ) as run:
            run.side_effect = [
                subprocess.CompletedProcess(
                    [], 0, stdout="libcustom.so => /lib/libcustom.so (0x1)"
                ),
                subprocess.CompletedProcess([], 1, stdout=""),
            ]
            with self.assertRaisesRegex(RuntimeError, "Unowned native library"):
                RUNTIME.required_packages(Path(directory))

    def test_actual_elf_owner_is_kept_while_base_and_vendored_dependencies_are_distinct(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            RUNTIME.subprocess, "run"
        ) as run:
            run.side_effect = [
                subprocess.CompletedProcess([], 0, stdout=(
                    "libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x1)\n"
                    "libcrypt.so.1 => /lib/x86_64-linux-gnu/libcrypt.so.1 (0x2)\n"
                    "libvendor.so => /app/.venv/lib/vendor/libvendor.so (0x3)\n"
                )),
                subprocess.CompletedProcess([], 0, stdout=(
                    "libcrypt1:amd64: /lib/x86_64-linux-gnu/libcrypt.so.1\n"
                )),
            ]
            self.assertEqual(RUNTIME.required_packages(Path(directory)), ["libcrypt1"])
            self.assertEqual(run.call_count, 2)
            self.assertIn("/usr/lib/x86_64-linux-gnu/libcrypt.so.1", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()

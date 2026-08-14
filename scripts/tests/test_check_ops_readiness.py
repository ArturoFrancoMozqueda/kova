from __future__ import annotations

import importlib.util
import hashlib
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "check_ops_readiness.py"
SPEC = importlib.util.spec_from_file_location("check_ops_readiness", SCRIPT)
assert SPEC and SPEC.loader
OPS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OPS)


class RepositoryGateTests(unittest.TestCase):
    def test_current_repository_contracts_pass(self) -> None:
        self.assertEqual(OPS.repository_errors(), [])


class RestorePreflightTests(unittest.TestCase):
    def _dump(self, directory: str) -> Path:
        dump = Path(directory) / "backup.dump"
        dump.write_bytes(b"PGDMP\x01fixture")
        return dump

    def test_accepts_disposable_supabase_session_pooler(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            errors = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/"
                    "postgres?sslmode=require"
                ),
                backup=self._dump(directory),
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256=None,
            )
        self.assertEqual(errors, [])

    def test_rejects_production_target_and_transaction_pooler(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            errors = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.prod123:secret@aws.pooler.supabase.com:6543/"
                    "postgres?sslmode=require"
                ),
                backup=self._dump(directory),
                project_ref="prod123",
                production_project_ref="prod123",
                expected_sha256=None,
            )
        self.assertIn("el destino coincide con producción", errors)
        self.assertIn("RESTORE_URL debe usar el session pooler en puerto 5432", errors)

    def test_rejects_non_dump_and_missing_ssl(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dump = Path(directory) / "backup.dump"
            dump.write_text("not a dump", encoding="utf-8")
            errors = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/postgres"
                ),
                backup=dump,
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256=None,
            )
        self.assertIn("RESTORE_URL debe exigir SSL", errors)
        self.assertIn("el archivo no tiene cabecera de dump custom de PostgreSQL", errors)

    def test_verifies_expected_sha256(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dump = self._dump(directory)
            digest = hashlib.sha256(dump.read_bytes()).hexdigest()
            valid = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/"
                    "postgres?sslmode=require"
                ),
                backup=dump,
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256=digest,
            )
            invalid = OPS.validate_restore_target(
                restore_url=(
                    "postgresql://postgres.restore123:secret@aws.pooler.supabase.com:5432/"
                    "postgres?sslmode=require"
                ),
                backup=dump,
                project_ref="restore123",
                production_project_ref="prod123",
                expected_sha256="0" * 64,
            )
        self.assertEqual(valid, [])
        self.assertIn("el SHA-256 del dump no coincide", invalid)


if __name__ == "__main__":
    unittest.main()

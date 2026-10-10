import hashlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "restore_backup_drill", Path(__file__).resolve().parents[1] / "restore_backup_drill.py"
)
DRILL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRILL)


def environment(temp):
    return {
        "GITHUB_ACTIONS": "true", "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch", "RUNNER_ENVIRONMENT": "github-hosted",
        "RUNNER_OS": "Linux", "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1",
        "RUNNER_TEMP": str(temp), "GITHUB_SHA": "a" * 40,
        "RESTORE_ACKNOWLEDGEMENT": DRILL.ACKNOWLEDGEMENT,
        "AWS_ACCESS_KEY_ID": "synthetic-access-canary", "AWS_SECRET_ACCESS_KEY": "synthetic-secret-canary",
        "CLOUDFLARE_ACCOUNT_ID": "b" * 32, "R2_BUCKET": "synthetic-backup-bucket",
    }


def container(identity="123-1", **host_overrides):
    return [{
        "Config": {"Labels": {DRILL.LABEL: identity}, "User": "postgres"},
        "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True,
                       "PortBindings": {}, **host_overrides},
        "Mounts": [{"Type": "tmpfs"}],
    }]


class RestoreSafetyTests(unittest.TestCase):
    def test_requires_explicit_manual_main_hosted_runner_and_acknowledgement(self):
        with tempfile.TemporaryDirectory() as directory:
            env = environment(directory)
            DRILL.runner_identity(env)
            for key, value in (
                ("GITHUB_REF", "refs/heads/fix"), ("GITHUB_EVENT_NAME", "push"),
                ("RUNNER_ENVIRONMENT", "self-hosted"), ("RESTORE_ACKNOWLEDGEMENT", ""),
                ("GITHUB_RUN_ID", "../production"), ("RUNNER_TEMP", "/"),
            ):
                with self.subTest(key=key), self.assertRaises(DRILL.DrillError):
                    DRILL.runner_identity({**env, key: value})

    def test_backup_selection_rejects_stale_future_and_foreign_objects(self):
        now = datetime(2026, 10, 10, 16, tzinfo=UTC)
        expected = "supabase/postgres/kova-2026-10-10T15-04-00Z.dump"
        key, _ = DRILL.select_backup([
            {"Key": expected}, {"Key": "../production.dump"},
            {"Key": "supabase/postgres/kova-2026-10-09T15-04-00Z.dump"},
        ], now)
        self.assertEqual(key, expected)
        for timestamp in (now - timedelta(days=3), now + timedelta(hours=1)):
            with self.subTest(timestamp=timestamp), self.assertRaises(DRILL.DrillError):
                DRILL.select_backup([{
                    "Key": f"supabase/postgres/kova-{timestamp:%Y-%m-%dT%H-%M-%SZ}.dump"
                }], now)
        with self.assertRaises(DRILL.DrillError):
            DRILL.select_backup([{"Key": "other-provider.sql"}], now)

    def test_requires_custom_archive_and_exact_trusted_checksum_and_size(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "backup.dump"
            payload = b"PGDMPsynthetic-backup"
            path.write_bytes(payload)
            metadata = {"ContentLength": len(payload), "Metadata": {"sha256": hashlib.sha256(payload).hexdigest()}}
            DRILL.validate_dump(path, metadata)
            for invalid in (
                {**metadata, "ContentLength": len(payload)+1},
                {**metadata, "Metadata": {}},
                {**metadata, "Metadata": {"sha256": "c" * 64}},
            ):
                with self.subTest(metadata=invalid), self.assertRaises(DRILL.DrillError):
                    DRILL.validate_dump(path, invalid)
            path.write_bytes(b"SELECT synthetic private data")
            with self.assertRaises(DRILL.DrillError):
                DRILL.validate_dump(path, {"ContentLength": path.stat().st_size, "Metadata": {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}})

    def test_rejects_network_ports_host_mounts_or_wrong_container_owner(self):
        DRILL.validate_container(container(), "123-1")
        invalid = [container(NetworkMode="bridge"), container(ReadonlyRootfs=False),
                   container(PortBindings={"5432/tcp": [{"HostPort": "5432"}]}), container("other-run")]
        mounted = container()
        mounted[0]["Mounts"] = [{"Type": "bind", "Source": "/production"}]
        invalid.append(mounted)
        for details in invalid:
            with self.subTest(details=details), self.assertRaises(DRILL.DrillError):
                DRILL.validate_container(details, "123-1")

    def test_cleanup_never_removes_unrelated_container(self):
        calls = []
        def run(args):
            calls.append(args)
            return json.dumps(container("other-run")).encode() if "inspect" in args else b"container-id"
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(DRILL.DrillError):
            DRILL.cleanup("123-1", "kova-r2-restore-123-1", Path(directory)/"private", run)
        self.assertFalse(any("rm" in args for args in calls))

    def test_cleanup_removes_own_rejected_container_and_its_anonymous_volumes(self):
        calls = []
        state = {"live": True}
        def run(args):
            calls.append(args)
            if "inspect" in args:
                return json.dumps(container(NetworkMode="bridge")).encode()
            if "rm" in args:
                state["live"] = False
            return b"container-id" if state["live"] else b""
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory)/"private"
            private.mkdir()
            (private/"backup.dump").write_bytes(b"synthetic private dump")
            DRILL.cleanup("123-1", "kova-r2-restore-123-1", private, run)
            self.assertFalse(private.exists())
        self.assertIn(["docker", "rm", "--volumes", "-f", "kova-r2-restore-123-1"], calls)

    def test_provider_failure_output_is_never_in_error(self):
        result = subprocess.CompletedProcess([], 1, b"private-row-canary", b"secret-canary")
        with patch.object(DRILL.subprocess, "run", return_value=result):
            with self.assertRaises(DRILL.DrillError) as caught:
                DRILL.run_command(["aws", "s3api", "head-object"])
        self.assertNotIn("canary", str(caught.exception))

    def test_failures_cleanup_dump_and_never_publish_evidence(self):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            if args[0] == "aws":
                raise DRILL.DrillError("provider failure")
            return b""
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(DRILL.DrillError):
                DRILL.restore(environment(directory), run)
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertTrue(any(args[:3] == ["docker", "ps", "-aq"] for args in calls))

    def test_orchestration_uses_only_container_socket_and_keeps_dump_out_of_evidence(self):
        calls = []
        state = {"live": False}
        payload = b"PGDMPsynthetic-private-row-canary"
        key = f"supabase/postgres/kova-{datetime.now(UTC):%Y-%m-%dT%H-%M-%SZ}.dump"
        def run(args, *, input_data=None, **kwargs):
            calls.append(args)
            if args[:3] == ["aws", "s3api", "list-objects-v2"]:
                return json.dumps({"Contents": [{"Key": key}]}).encode()
            if args[:3] == ["aws", "s3api", "head-object"]:
                return json.dumps({"ContentLength": len(payload), "Metadata": {
                    "sha256": hashlib.sha256(payload).hexdigest()
                }}).encode()
            if args[:3] == ["aws", "s3api", "get-object"]:
                Path(args[-1]).write_bytes(payload)
            if args[:2] == ["docker", "run"]:
                state["live"] = True
            if args[:2] == ["docker", "inspect"]:
                return json.dumps(container()).encode()
            if args[:3] == ["docker", "ps", "-aq"]:
                return b"synthetic-id" if state["live"] else b""
            if args[:2] == ["docker", "rm"]:
                state["live"] = False
            if input_data == b"SHOW server_version_num;":
                return b"170006"
            if input_data == (DRILL.ROOT / "scripts/restore_backup_checks.sql").read_bytes():
                return json.dumps({"revision": "0078_drawer_bridge", "orders": 31}).encode()
            return b""
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()):
            DRILL.restore(environment(directory), run)
            report = json.loads((Path(directory)/"kova-r2-restore-evidence.json").read_text())
            self.assertTrue(report["cleanup_verified"])
            self.assertNotIn("canary", json.dumps(report))
            self.assertEqual(len(list(Path(directory).iterdir())), 1)
        pg_restore = next(args for args in calls if "pg_restore" in args)
        self.assertEqual(pg_restore[:4], ["docker", "exec", "kova-r2-restore-123-1", "pg_restore"])
        self.assertEqual(pg_restore[pg_restore.index("-h")+1], "/tmp")
        self.assertEqual(pg_restore[pg_restore.index("--dbname")+1], "kova_restore")
        self.assertIn("--exit-on-error", pg_restore)
        self.assertIn("--single-transaction", pg_restore)
        self.assertFalse(any("--create" in args or "--disable-triggers" in args for args in calls))
        docker_run = next(args for args in calls if args[:2] == ["docker", "run"])
        self.assertIn("/var/lib/postgresql/data:rw,nosuid,mode=1777,size=16m", docker_run)

    def test_workflow_is_manual_and_never_receives_production_database_credentials(self):
        workflow = (DRILL.ROOT / ".github/workflows/db-restore-drill.yml").read_text()
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("if: always()", workflow)
        self.assertIn("persist-credentials: false", workflow)
        for forbidden in ("SUPABASE_DB_URL", "DATABASE_URL", "RESTORE_URL", "schedule:", "pull_request:", "push:"):
            self.assertNotIn(forbidden, workflow)
        self.assertEqual(workflow.count("secrets."), 4)


if __name__ == "__main__":
    unittest.main()

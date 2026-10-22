import importlib.util
import io
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
from sqlalchemy.engine import make_url

_SPEC = importlib.util.spec_from_file_location(
    "native_runtime_provision",
    Path(__file__).resolve().parents[2] / "scripts/provision_native_runtime.py",
)
script = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(script)

OWNER = "postgresql://postgres:synthetic-owner@db.example.com:5432/postgres?sslmode=require"


class NativeDatabaseUrlTests(unittest.TestCase):
    def test_pooler_project_and_tls_are_preserved_with_independent_password(self):
        source = (
            "postgresql+psycopg://postgres.abcdefghijklmnopqrst:synthetic-owner"
            "@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full"
        )
        runtime, privileged = script.database_urls(source, "synthetic/@new-password")
        self.assertEqual(runtime.username, "kova_native_app.abcdefghijklmnopqrst")
        self.assertEqual(runtime.host, privileged.host)
        self.assertEqual(runtime.port, 5432)
        self.assertEqual(runtime.query["sslmode"], "verify-full")
        self.assertEqual(make_url(runtime.render_as_string(hide_password=False)).password,
                         "synthetic/@new-password")
        self.assertEqual(privileged.password, "synthetic-owner")

    def test_direct_endpoint_does_not_get_a_pooler_suffix(self):
        runtime, _ = script.database_urls(OWNER, "synthetic-password")
        self.assertEqual(runtime.username, "kova_native_app")
        self.assertEqual(runtime.host, "db.example.com")

    def test_missing_tls_is_upgraded_but_disabled_tls_and_role_options_are_rejected(self):
        runtime, privileged = script.database_urls(OWNER.split("?")[0], "synthetic")
        self.assertEqual(runtime.query["sslmode"], "require")
        self.assertEqual(privileged.query["sslmode"], "require")
        for query in (
            "sslmode=disable", "options=-crole%3Dpostgres", "sslmode=prefer",
            "user=postgres", "host=another-host", "password=owner-password",
        ):
            with self.subTest(query=query), self.assertRaises(script.ProvisionError):
                script.database_urls(OWNER.split("?")[0] + "?" + query, "synthetic")

    def test_ambiguous_pooler_identity_is_rejected(self):
        with self.assertRaises(script.ProvisionError):
            script.database_urls(OWNER.replace("db.example.com", "test.pooler.supabase.com"), "x")


class ProvisionRollbackTests(unittest.TestCase):
    def setUp(self):
        self.conn = MagicMock()
        self.conn.__enter__.return_value = self.conn
        # Advisory lock, new-role absence, source posture, memberships, ownership.
        self.conn.execute.side_effect = [
            MagicMock(),
            MagicMock(fetchone=lambda: None),
            MagicMock(fetchone=lambda: (False, False, False, False, False)),
            MagicMock(fetchone=lambda: None),
            MagicMock(fetchone=lambda: None),
            MagicMock(),
            MagicMock(),
        ]
        self.conn.pgconn.encrypt_password.return_value = b"SCRAM-SHA-256$synthetic-verifier"
        self.connect = MagicMock(return_value=self.conn)
        self.store = MagicMock()
        self.store.names.return_value = {"SECRET_KEY", "STRIPE_SECRET_KEY"}

    def test_success_seals_distinct_runtime_and_privileged_urls_without_deletion(self):
        script.provision(OWNER, self.store, connect=self.connect)
        sealed = dict(call.args for call in self.store.put.call_args_list)
        self.assertEqual(make_url(sealed["APP_DATABASE_URL"]).username, "kova_native_app")
        self.assertEqual(make_url(sealed["MIGRATION_DATABASE_URL"]).username, "postgres")
        self.assertNotEqual(make_url(sealed["APP_DATABASE_URL"]).password, "synthetic-owner")
        self.store.delete.assert_not_called()
        self.assertIsNone(self.conn.__exit__.call_args.args[0])

    def test_second_seal_failure_rolls_back_sql_and_cleans_both_new_names(self):
        self.store.put.side_effect = [None, RuntimeError("credential-bearing provider response")]
        with self.assertRaisesRegex(script.ProvisionError, "aborted"):
            script.provision(OWNER, self.store, connect=self.connect)
        self.assertEqual([call.args[0] for call in self.store.delete.call_args_list],
                         list(script.SECRET_NAMES))
        self.assertIsNotNone(self.conn.__exit__.call_args.args[0])

    def test_timeout_on_first_seal_still_cleans_an_uncertain_remote_write(self):
        self.store.put.side_effect = TimeoutError("upstream may have accepted the request")
        with self.assertRaises(script.ProvisionError):
            script.provision(OWNER, self.store, connect=self.connect)
        self.assertEqual(self.store.delete.call_count, 2)

    def test_existing_secrets_are_never_overwritten_or_deleted(self):
        self.store.names.return_value = {"APP_DATABASE_URL"}
        with self.assertRaises(script.ProvisionError):
            script.provision(OWNER, self.store, connect=self.connect)
        self.store.put.assert_not_called()
        self.store.delete.assert_not_called()
        self.conn.pgconn.encrypt_password.assert_not_called()

    def test_existing_role_is_not_rotated(self):
        self.conn.execute.side_effect = [MagicMock(), MagicMock(fetchone=lambda: (1,))]
        with self.assertRaises(script.ProvisionError):
            script.provision(OWNER, self.store, connect=self.connect)
        self.store.put.assert_not_called()
        self.store.delete.assert_not_called()
        self.conn.pgconn.encrypt_password.assert_not_called()

    def test_unsafe_source_role_is_not_inherited(self):
        self.conn.execute.side_effect = [
            MagicMock(), MagicMock(fetchone=lambda: None),
            MagicMock(fetchone=lambda: (False, True, False, False, False)),
        ]
        with self.assertRaises(script.ProvisionError):
            script.provision(OWNER, self.store, connect=self.connect)
        self.store.put.assert_not_called()

    def test_source_ownership_cannot_be_inherited_to_bypass_table_security(self):
        self.conn.execute.side_effect = [
            MagicMock(), MagicMock(fetchone=lambda: None),
            MagicMock(fetchone=lambda: (False, False, False, False, False)),
            MagicMock(fetchone=lambda: None), MagicMock(fetchone=lambda: (1,)),
        ]
        with self.assertRaises(script.ProvisionError):
            script.provision(OWNER, self.store, connect=self.connect)
        self.store.put.assert_not_called()

    def test_failed_cleanup_has_an_explicit_safe_diagnostic(self):
        self.store.put.side_effect = RuntimeError("secret-url-in-error")
        self.store.delete.side_effect = RuntimeError("secret-token-in-error")
        with self.assertRaisesRegex(script.ProvisionError, "verify removal") as caught:
            script.provision(OWNER, self.store, connect=self.connect)
        self.assertNotIn("secret-url", str(caught.exception))
        self.assertNotIn("secret-token", str(caught.exception))


class SecretClientTests(unittest.TestCase):
    def test_remote_error_body_is_not_exposed(self):
        transport = httpx.MockTransport(lambda request: httpx.Response(
            500, json={"success": False, "errors": [{"message": "synthetic-secret-value"}]}
        ))
        with httpx.Client(transport=transport) as client:
            store = script.WorkerSecrets("a" * 32, "synthetic-token", client)
            with self.assertRaises(script.ProvisionError) as caught:
                store.put("APP_DATABASE_URL", "synthetic-secret-value")
        self.assertNotIn("synthetic-secret", str(caught.exception))

    def test_cleanup_of_a_missing_secret_is_successful(self):
        transport = httpx.MockTransport(lambda request: httpx.Response(404))
        with httpx.Client(transport=transport) as client:
            script.WorkerSecrets("a" * 32, "synthetic-token", client).delete("APP_DATABASE_URL")

    def test_non_ci_execution_does_not_read_or_write_remote_credentials(self):
        output = io.StringIO()
        with patch.object(script, "provision") as provision, redirect_stderr(output):
            result = script.main(["--provision-once"], environ={})
        self.assertEqual(result, 2)
        provision.assert_not_called()

    def test_cli_never_prints_untrusted_exception_messages(self):
        output = io.StringIO()
        env = {"CI": "true", "GITHUB_ACTIONS": "true", "SUPABASE_DB_URL": OWNER,
               "CLOUDFLARE_ACCOUNT_ID": "a" * 32, "CLOUDFLARE_API_TOKEN": "synthetic"}
        with (
            patch.object(script, "provision", side_effect=RuntimeError("synthetic-password")),
            redirect_stderr(output), redirect_stdout(output),
        ):
            result = script.main(["--provision-once"], environ=env)
        self.assertEqual(result, 1)
        self.assertNotIn("synthetic-password", output.getvalue())


if __name__ == "__main__":
    unittest.main()

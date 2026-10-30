import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("restore_service_smoke", Path(__file__).resolve().parents[1] / "restore_service_smoke.py")
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class RestoreServiceIsolationTests(unittest.TestCase):
    def environment(self):
        return {
            "RESTORE_DRILL_ID": "123-1", "APP_ENV": "ci", "CLOUDFLARE_CONTAINER_MODE": "false",
            "DATABASE_URL": "postgresql+psycopg://restore_owner:ephemeral@127.0.0.1:5432/kova_restore?sslmode=disable",
            "APP_DATABASE_URL": "postgresql+psycopg://kova_app:ephemeral@127.0.0.1:5432/kova_restore?sslmode=disable",
        }

    def test_allows_only_throwaway_loopback_database_and_no_external_credentials(self):
        SMOKE.validate_environment(self.environment(), ["lo"])
        for key, value in (
            ("RESTORE_DRILL_ID", "production"), ("APP_ENV", "production"),
            ("CLOUDFLARE_CONTAINER_MODE", "true"), ("STRIPE_SECRET_KEY", "synthetic-canary"),
            ("RESEND_API_KEY", "synthetic-canary"), ("SENTRY_DSN", "synthetic-canary"),
            ("MIGRATION_DATABASE_URL", "synthetic-canary"),
        ):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                SMOKE.validate_environment({**self.environment(), key: value}, ["lo"])
        with self.assertRaises(RuntimeError):
            SMOKE.validate_environment(self.environment(), ["lo", "eth0"])

    def test_refuses_other_database_hosts_roles_or_connection_options(self):
        for key in ("DATABASE_URL", "APP_DATABASE_URL"):
            baseline = self.environment()[key]
            for value in (
                baseline.replace("127.0.0.1", "production.invalid"),
                baseline.replace("5432", "6543"), baseline.replace("/kova_restore", "/postgres"),
                baseline.replace("sslmode=disable", "host=production.invalid"),
                baseline + "&host=production.invalid", baseline.replace(":ephemeral@", "@"),
            ):
                with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                    SMOKE.validate_environment({**self.environment(), key: value}, ["lo"])


if __name__ == "__main__":
    unittest.main()

import importlib.util
from pathlib import Path
import unittest

_SPEC = importlib.util.spec_from_file_location(
    "cloudflare_backend_config",
    Path(__file__).resolve().parents[2] / "deploy/cloudflare-backend/prepare_config.py",
)
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)


class HyperdriveOriginTests(unittest.TestCase):
    def test_pooler_conversion_preserves_least_privilege_and_password_encoding(self):
        value = _MODULE.database_origin(
            "postgresql+psycopg://kova_app.abcdefghijklmnopqrst:synthetic%40password"
            "@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require"
        )
        self.assertEqual(value["host"], "db.abcdefghijklmnopqrst.supabase.co")
        self.assertEqual(value["port"], 5432)
        self.assertEqual(value["user"], "kova_app")
        self.assertEqual(value["password"], "synthetic@password")

    def test_direct_connection_keeps_its_role_and_endpoint(self):
        value = _MODULE.database_origin("postgresql://kova_app:synthetic@db.example.com:5433/postgres")
        self.assertEqual((value["host"], value["port"], value["user"]),
                         ("db.example.com", 5433, "kova_app"))

    def test_ambiguous_pooler_identity_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "metadata"):
            _MODULE.database_origin("postgresql://kova_app:synthetic@aws-0-region.pooler.supabase.com/postgres")

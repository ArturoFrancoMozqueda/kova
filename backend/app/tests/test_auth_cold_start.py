"""Importing authentication must not hash passwords before a request exists."""

import subprocess
import sys


def test_cold_import_uses_valid_production_cost_dummy_without_generating_a_hash():
    result = subprocess.run(
        [sys.executable, "-c", """
import bcrypt

def unexpected_hash(*args, **kwargs):
    raise AssertionError("Cold import generated a password hash")

bcrypt.hashpw = unexpected_hash
from app.auth import service
assert int(service._DUMMY_PASSWORD_HASH.split("$")[2]) == service._BCRYPT_ROUNDS == 12
assert service.verify_password("timing-equalizer-not-a-real-password", service._DUMMY_PASSWORD_HASH)
assert not service.verify_password("unrelated-password", service._DUMMY_PASSWORD_HASH)
"""],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, "Auth import or production-cost dummy verification failed"

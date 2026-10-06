"""Provision an immutable Fly encryption root without exposing secret values.

Run from backend/ with the existing deployment identity. `secrets list` returns
names/digests only. A new key travels to `secrets import --stage` through stdin,
never command arguments, logs, files, GitHub outputs, or the application image.
"""

import base64
import json
import secrets
import subprocess

KEY_NAME = "KOVA_CFDI_CREDENTIALS_KEY"


def ensure_storage_key(run=subprocess.run) -> bool:
    listed = run(
        ["flyctl", "secrets", "list", "--json"],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if listed.returncode:
        raise RuntimeError("Could not inspect host secret names; no key was changed")
    try:
        names = json.loads(listed.stdout)
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Invalid host secret metadata; no key was changed") from exc
    if not isinstance(names, list) or any(
        not isinstance(item, dict) or not isinstance(item.get("name", item.get("Name")), str)
        for item in names
    ):
        raise RuntimeError("Invalid host secret metadata; no key was changed")
    if any(item.get("name", item.get("Name")) == KEY_NAME for item in names):
        return False
    key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
    staged = run(
        ["flyctl", "secrets", "import", "--stage"],
        input=f"{KEY_NAME}={key}\n",
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if staged.returncode:
        # CLI output is deliberately not emitted: failure diagnostics may echo
        # a malformed stdin value. An operator can inspect names separately.
        raise RuntimeError("Could not stage fiscal encryption root; deployment must stop")
    return True


if __name__ == "__main__":
    try:
        created = ensure_storage_key()
    except Exception:
        raise SystemExit("Fiscal credential storage provisioning failed; deployment stopped") from None
    print("Fiscal encryption root staged" if created else "Existing fiscal encryption root retained")

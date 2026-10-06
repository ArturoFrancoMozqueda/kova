"""Encrypt organization keys with authenticated tenant/environment binding."""

import json
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class CredentialStorageUnavailable(RuntimeError):
    pass


def _cipher() -> Fernet:
    root = settings.kova_cfdi_credentials_key
    if root is None:
        raise CredentialStorageUnavailable("CFDI credential storage is not configured")
    try:
        return Fernet(root.get_secret_value().encode("ascii"))
    except (ValueError, UnicodeError) as exc:
        raise CredentialStorageUnavailable("CFDI credential storage is not configured") from exc


def storage_available() -> bool:
    if not settings.kova_cfdi_enabled:
        return False
    try:
        _cipher()
    except CredentialStorageUnavailable:
        return False
    return True


def encrypt_key(
    *, tenant_id: UUID, environment: str, organization_id: str, api_key: str
) -> str:
    payload = {
        "version": 1,
        "tenant_id": str(tenant_id),
        "environment": environment,
        "organization_id": organization_id,
        "api_key": api_key,
    }
    return _cipher().encrypt(json.dumps(payload, sort_keys=True).encode()).decode("ascii")


def decrypt_key(
    *, tenant_id: UUID, environment: str, organization_id: str, encrypted_key: str
) -> str:
    try:
        payload = json.loads(_cipher().decrypt(encrypted_key.encode("ascii")))
        expected = {
            "version": 1,
            "tenant_id": str(tenant_id),
            "environment": environment,
            "organization_id": organization_id,
        }
        if not isinstance(payload, dict) or any(payload.get(k) != v for k, v in expected.items()):
            raise ValueError("Credential scope mismatch")
        key = payload.get("api_key")
        if not isinstance(key, str) or not key:
            raise ValueError("Missing organization key")
        return key
    except (InvalidToken, ValueError, UnicodeError, TypeError) as exc:
        # Do not include the ciphertext, plaintext, or crypto error in responses/logs.
        raise CredentialStorageUnavailable("CFDI connection needs to be configured again") from exc

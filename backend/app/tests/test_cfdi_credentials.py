import base64
from uuid import UUID, uuid4

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr

from app.cfdi.credentials import (
    CredentialStorageUnavailable,
    decrypt_key,
    encrypt_key,
    storage_available,
)
from app.config import settings


def test_valid_ciphertext_can_contain_a_provider_prefix_without_exposing_the_key(monkeypatch):
    from app.cfdi import credentials

    root = base64.urlsafe_b64encode(bytes(range(32)))
    monkeypatch.setattr(settings, "kova_cfdi_credentials_key", SecretStr(root.decode()))
    cipher = Fernet(root)
    # Fixed test-only IV/time reproduce a legitimate Base64 prefix collision.
    monkeypatch.setattr(cipher, "encrypt", lambda data: cipher._encrypt_from_parts(
        data, 1700000000, (1750).to_bytes(16, "big"),
    ))
    monkeypatch.setattr(credentials, "_cipher", lambda: cipher)
    scope = dict(tenant_id=UUID(int=1), environment="test", organization_id="org-id")
    key = "sk_test_synthetic_only"
    encrypted = encrypt_key(**scope, api_key=key)
    assert "sk_" in encrypted
    assert key not in encrypted
    assert decrypt_key(**scope, encrypted_key=encrypted) == key


def test_provider_key_requires_dedicated_root_and_enabled_storage(monkeypatch):
    monkeypatch.setattr(settings, "kova_cfdi_credentials_key", None)
    assert not storage_available()
    monkeypatch.setattr(settings, "kova_cfdi_credentials_key", SecretStr("invalid"))
    assert not storage_available()
    monkeypatch.setattr(settings, "kova_cfdi_credentials_key", SecretStr(Fernet.generate_key().decode()))
    assert storage_available()
    monkeypatch.setattr(settings, "kova_cfdi_enabled", False)
    assert not storage_available()


def test_ciphertext_is_bound_to_business_environment_and_provider_organization(monkeypatch):
    monkeypatch.setattr(settings, "kova_cfdi_credentials_key", SecretStr(Fernet.generate_key().decode()))
    scope = dict(tenant_id=uuid4(), environment="test", organization_id="org-id")
    encrypted = encrypt_key(**scope, api_key="synthetic-organization-credential")
    assert "synthetic" not in encrypted
    assert decrypt_key(**scope, encrypted_key=encrypted) == "synthetic-organization-credential"
    for change in [
        {"tenant_id": uuid4()},
        {"environment": "live"},
        {"organization_id": "different-org"},
    ]:
        with pytest.raises(CredentialStorageUnavailable):
            decrypt_key(**{**scope, **change}, encrypted_key=encrypted)
    with pytest.raises(CredentialStorageUnavailable):
        decrypt_key(**scope, encrypted_key=encrypted[:-5] + "abcde")

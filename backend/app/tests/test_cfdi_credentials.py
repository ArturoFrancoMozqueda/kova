from uuid import uuid4

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

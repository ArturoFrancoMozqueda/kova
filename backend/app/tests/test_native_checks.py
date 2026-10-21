"""Fail closed on an old image or inaccessible configured private storage."""

from unittest.mock import Mock
from uuid import UUID

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.assistant import storage
from app.native_checks import validate_image_identity, validate_storage_transport


def test_native_image_identity_accepts_exact_complete_commit():
    validate_image_identity("a" * 40, "a" * 40)


@pytest.mark.parametrize("image,release", [
    (None, "a" * 40), ("unknown", "unknown"), ("a" * 12, "a" * 12),
    ("a" * 40, "b" * 40), ("g" * 40, "g" * 40),
])
def test_native_image_identity_rejects_missing_invalid_or_old_image(image, release):
    with pytest.raises(RuntimeError, match="image does not match the deployed release"):
        validate_image_identity(image, release)


def test_native_storage_keeps_optional_unconfigured_state(monkeypatch):
    monkeypatch.setattr(storage, "ready", lambda: False)
    exists = Mock(side_effect=AssertionError("Unconfigured storage must not be contacted"))
    monkeypatch.setattr(storage, "exists", exists)
    validate_storage_transport()
    exists.assert_not_called()


@pytest.mark.parametrize("missing", [False, True])
def test_native_storage_authenticated_head_only_accepts_absent_object(monkeypatch, missing):
    monkeypatch.setattr(storage, "ready", lambda: True)
    client = Mock()
    if missing:
        client.head_object.side_effect = ClientError({
            "Error": {"Code": "NotFound"}, "ResponseMetadata": {"HTTPStatusCode": 404},
        }, "HeadObject")
    monkeypatch.setattr(storage, "client", lambda: client)
    validate_storage_transport()
    client.head_object.assert_called_once()
    key = client.head_object.call_args.kwargs["Key"]
    tenant, document = key.split("/")
    assert UUID(tenant).version == UUID(document).version == 4
    assert tenant != document
    client.put_object.assert_not_called()
    client.get_object.assert_not_called()
    client.delete_object.assert_not_called()


@pytest.mark.parametrize("error", [
    ClientError({"Error": {"Code": "AccessDenied", "Message": "synthetic-sensitive-data"},
                 "ResponseMetadata": {"HTTPStatusCode": 403}}, "HeadObject"),
    EndpointConnectionError(endpoint_url="https://synthetic-sensitive-data.invalid"),
    RuntimeError("synthetic-sensitive-data"),
])
def test_native_storage_transport_failure_aborts_with_fixed_redacted_error(monkeypatch, error):
    monkeypatch.setattr(storage, "ready", lambda: True)
    client = Mock()
    client.head_object.side_effect = error
    monkeypatch.setattr(storage, "client", lambda: client)
    with pytest.raises(RuntimeError) as caught:
        validate_storage_transport()
    assert str(caught.value) == "Native private storage transport is not ready"
    assert caught.value.__suppress_context__ is True
    client.put_object.assert_not_called()
    client.get_object.assert_not_called()
    client.delete_object.assert_not_called()

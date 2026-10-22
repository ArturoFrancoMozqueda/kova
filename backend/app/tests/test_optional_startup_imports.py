"""Optional parsers and native S3 transport stay off unrelated startup paths."""

import subprocess
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from app.assistant import storage


def test_startup_and_csv_do_not_load_optional_parser_or_native_transport():
    script = '''
import importlib.abc
import sys

class BlockOptional(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "openpyxl" or fullname.startswith("openpyxl.") or fullname in {
            "boto3", "botocore.config"
        } or fullname.startswith("boto3."):
            raise AssertionError("Unexpected optional startup import: " + fullname)

sys.meta_path.insert(0, BlockOptional())
from app.imports import service
from app.assistant import storage
assert service._parse_catalog_csv(b"nombre,precio\\nPan,12.50\\n") == [
    (2, {"nombre": "Pan", "precio": "12.50"})
]
# Malformed XLSX is rejected by the existing ZIP guard before loading the parser.
from fastapi import HTTPException
try:
    service._parse_catalog_xlsx(b"invalid")
except HTTPException as exc:
    assert exc.status_code == 400
else:
    raise AssertionError("Malformed XLSX was accepted")
storage.ready = lambda: True
sys.platform = "emscripten"
assert storage.client().__class__.__name__ == "R2Client"
assert "openpyxl" not in sys.modules
assert "boto3" not in sys.modules
assert "botocore.config" not in sys.modules
'''
    result = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script)],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_native_storage_client_keeps_destination_and_transport_limits(monkeypatch):
    import boto3
    from pydantic import SecretStr

    observed = {}
    sentinel = object()

    def create_client(service, **kwargs):
        observed.update(service=service, **kwargs)
        return sentinel

    monkeypatch.setattr(storage.sys, "platform", "linux")
    monkeypatch.setattr(storage, "ready", lambda: True)
    monkeypatch.setattr(storage, "settings", SimpleNamespace(
        assistant_cloudflare_account_id="a" * 32,
        assistant_r2_access_key=SecretStr("synthetic-access"),
        assistant_r2_secret_key=SecretStr("synthetic-secret"),
    ))
    monkeypatch.setattr(boto3, "client", create_client)
    assert storage.client() is sentinel
    assert observed["service"] == "s3"
    assert observed["endpoint_url"] == f"https://{'a' * 32}.r2.cloudflarestorage.com"
    assert observed["region_name"] == "auto"
    assert observed["aws_access_key_id"] == "synthetic-access"
    assert observed["aws_secret_access_key"] == "synthetic-secret"
    config = observed["config"]
    assert (config.connect_timeout, config.read_timeout) == (5, 30)
    assert config.retries == {"total_max_attempts": 1}
    assert config.proxies == {}


def test_unconfigured_storage_still_rejects_before_client_selection(monkeypatch):
    monkeypatch.setattr(storage, "ready", lambda: False)
    with pytest.raises(HTTPException) as error:
        storage.client()
    assert error.value.status_code == 503


@pytest.mark.parametrize("operation", ["put", "get", "delete", "exists"])
@pytest.mark.parametrize("error", [BotoCoreError(), ClientError(
    {"ResponseMetadata": {"HTTPStatusCode": 503}}, "GetObject"
)])
def test_storage_transport_errors_keep_private_unavailable_response(monkeypatch, operation, error):
    def fail(**kwargs):
        raise error

    monkeypatch.setattr(storage, "client", lambda: SimpleNamespace(
        put_object=fail, get_object=fail, delete_object=fail, head_object=fail,
    ))
    args = (uuid4(), uuid4(), b"private") if operation == "put" else (uuid4(), uuid4())
    with pytest.raises(HTTPException) as caught:
        getattr(storage, operation)(*args)
    assert caught.value.status_code == 503

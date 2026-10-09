"""Multipart certificates stay bounded in memory and are never logged/spooled."""

import httpx
import pytest
from fastapi import HTTPException

from app.cfdi.uploads import MAX_BODY_BYTES, parse_certificate


def multipart(files=None, password=b"synthetic-password"):
    request = httpx.Request("POST", "http://test/upload", files=files or [
        ("cer", ("certificate.cer", b"cer\r\n", "application/octet-stream")),
        ("key", ("private.key", b"key\r\n", "application/octet-stream")),
        ("password", (None, password)),
    ])
    return request.headers["content-type"], request.read()


def test_binary_files_remain_exact_including_trailing_crlf():
    content_type, body = multipart()
    assert parse_certificate(content_type, body) == (b"cer\r\n", b"key\r\n", "synthetic-password")


@pytest.mark.parametrize("files", [
    [("cer", ("certificate.cer", b"a")), ("cer", ("duplicate.cer", b"b"))],
    [("cer", ("wrong.txt", b"a"))],
    [("cer", ("certificate.cer", b"a" * (64 * 1024 + 1)))],
    [("cer", ("certificate.cer", b""))],
    [("password", ("filename", b"password"))],
    [("other", (None, "value"))],
])
def test_rejects_invalid_duplicate_oversized_and_missing_fields(files):
    with pytest.raises(HTTPException) as error:
        parse_certificate(*multipart(files))
    assert error.value.status_code == 400


def test_invalid_utf8_password_does_not_attach_secret_exception_context():
    with pytest.raises(HTTPException) as error:
        parse_certificate(*multipart(password=b"secret-\xff-password"))
    assert error.value.__context__ is None
    assert "secret" not in str(error.value)


@pytest.mark.parametrize("content_type, body", [
    ("application/json", b"{}"),
    ("multipart/form-data; boundary=a", b"broken"),
    ("multipart/form-data; boundary=a\r\nX-Evil: true", b"a"),
    ("multipart/form-data; boundary=a", b"a" * (MAX_BODY_BYTES + 1)),
])
def test_rejects_malformed_envelopes(content_type, body):
    with pytest.raises(HTTPException) as error:
        parse_certificate(content_type, body)
    assert error.value.status_code == 400

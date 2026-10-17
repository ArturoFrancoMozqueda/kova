"""Existing ciphertext formats backed by native Workers crypto, never obsolete wheels.

This is intentionally private to the Workers adapter. No signing keys, plaintext,
ciphertext or underlying crypto exception is retained in public exceptions.
"""

import base64
import binascii
import hashlib
import hmac
import os
import struct
import time
from functools import cache


@cache
def primitives():
    from workers import import_from_javascript

    return import_from_javascript("platform-crypto.mjs")


def js_bytes(value: bytes):
    from pyodide.ffi import to_js

    return to_js(value)


class InvalidToken(Exception):
    pass


class Fernet:
    """Fernet v0 framing; AES-CBC and padding are provided by node:crypto."""

    def __init__(self, key: bytes):
        try:
            decoded = base64.urlsafe_b64decode(key)
        except (ValueError, binascii.Error):
            raise ValueError("Invalid encryption key") from None
        if len(decoded) != 32:
            raise ValueError("Invalid encryption key")
        self.signing_key, self.encryption_key = decoded[:16], decoded[16:]

    @staticmethod
    def generate_key() -> bytes:
        return base64.urlsafe_b64encode(os.urandom(32))

    def encrypt(self, data: bytes) -> bytes:
        iv = os.urandom(16)
        encrypted = bytes(
            primitives().encryptCbc(
                js_bytes(self.encryption_key),
                js_bytes(iv),
                js_bytes(data),
            )
        )
        payload = b"\x80" + struct.pack(">Q", int(time.time())) + iv + encrypted
        signature = hmac.digest(self.signing_key, payload, hashlib.sha256)
        return base64.urlsafe_b64encode(payload + signature)

    def decrypt(self, token: bytes) -> bytes:
        # Kova's credential storage deliberately has no TTL; environment/tenant
        # authorization is authenticated inside the decrypted versioned payload.
        try:
            payload = base64.urlsafe_b64decode(token)
            if len(payload) < 73 or payload[0] != 128:
                raise ValueError
            body, signature = payload[:-32], payload[-32:]
            expected = hmac.digest(self.signing_key, body, hashlib.sha256)
            if not hmac.compare_digest(expected, signature):
                raise ValueError
            return bytes(
                primitives().decryptCbc(
                    js_bytes(self.encryption_key),
                    js_bytes(body[9:25]),
                    js_bytes(body[25:]),
                )
            )
        except Exception:
            raise InvalidToken from None


class AESGCM:
    """Kova's existing 256-bit, 128-bit-tag authenticated outbox format."""

    def __init__(self, key: bytes):
        if len(key) != 32:
            raise ValueError("A 256-bit encryption key is required")
        self.key = key

    def encrypt(self, nonce: bytes, data: bytes, aad: bytes) -> bytes:
        if len(nonce) != 12:
            raise ValueError("A 96-bit nonce is required")
        return bytes(
            primitives().encryptGcm(
                js_bytes(self.key),
                js_bytes(nonce),
                js_bytes(data),
                js_bytes(aad),
            )
        )

    def decrypt(self, nonce: bytes, data: bytes, aad: bytes) -> bytes:
        try:
            if len(nonce) != 12:
                raise ValueError
            return bytes(
                primitives().decryptGcm(
                    js_bytes(self.key),
                    js_bytes(nonce),
                    js_bytes(data),
                    js_bytes(aad),
                )
            )
        except Exception:
            raise ValueError("Invalid authenticated ciphertext") from None

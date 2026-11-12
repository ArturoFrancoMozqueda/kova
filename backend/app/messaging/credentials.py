"""Authenticated encryption, bound to the exact merchant, branch and assets."""

import json
import sys

from pydantic import SecretStr

from app.config import settings
from app.messaging.whatsapp import ChannelError

if sys.platform == "emscripten":
    from app.workers.crypto import Fernet, InvalidToken
else:
    from cryptography.fernet import Fernet, InvalidToken


def _cipher():
    try:
        key = settings.whatsapp_credentials_key
        if key is None:
            raise ValueError
        return Fernet(key.get_secret_value().encode("ascii"))
    except (ValueError, UnicodeError):
        raise ChannelError("channel_configuration_invalid") from None


def available():
    try:
        _cipher()
        return True
    except ChannelError:
        return False


def _scope(tenant, branch, waba, phone):
    return {
        "version": 1,
        "tenant": str(tenant),
        "branch": str(branch),
        "waba": waba,
        "phone": phone,
    }


def encrypt(*, tenant, branch, waba, phone, token, pin=None):
    payload = {**_scope(tenant, branch, waba, phone), "token": token.get_secret_value(), "pin": pin}
    return _cipher().encrypt(json.dumps(payload).encode()).decode("ascii")


def decrypt(*, tenant, branch, waba, phone, encrypted):
    try:
        payload = json.loads(_cipher().decrypt(encrypted.encode("ascii")))
        if not isinstance(payload, dict):
            raise ValueError
        if any(payload.get(k) != v for k, v in _scope(tenant, branch, waba, phone).items()):
            raise ValueError
        token = payload["token"]
        if (
            not isinstance(token, str)
            or not 1 <= len(token) <= 4096
            or not token.isascii()
            or any(c.isspace() for c in token)
        ):
            raise ValueError
        return SecretStr(token), payload.get("pin")
    except (InvalidToken, ValueError, KeyError, TypeError, UnicodeError):
        raise ChannelError("channel_configuration_invalid") from None

"""Coexistence payloads, bounded and without contact identity inference."""

import hashlib
import json
import re
from datetime import UTC, datetime

from app.messaging.webhooks import (
    ChannelEvent,
    _list,
    _mapping,
    _message_id,
    _party,
    _timestamp,
)

APP_FIELDS = {"history", "smb_app_state_sync", "smb_message_echoes"}
MAX_APP_EVENTS = 20000


def identity(phone=None, user_id=None):
    if isinstance(phone, str) and re.fullmatch(r"\+?[0-9 ()-]{6,40}", phone):
        digits = re.sub(r"[^0-9]", "", phone)
        if re.fullmatch(r"[1-9][0-9]{5,19}", digits):
            return digits
    if user_id is not None:
        value = _party(user_id)
        if len(value) > 250:
            raise ValueError("invalid_identity")
        return "bsuid:" + value
    raise ValueError("invalid_identity")


def _event(kind, mid, timestamp, **kwargs):
    return ChannelEvent(
        kind=kind,
        message_id=mid,
        timestamp=timestamp,
        dedupe_key=hashlib.sha256(f"{kind}:{mid}".encode()).hexdigest(),
        **kwargs,
    )


def _content(message):
    kind = message.get("type")
    if not isinstance(kind, str) or not re.fullmatch(r"[a-z_]{1,40}", kind):
        raise ValueError("invalid_message_type")
    body = None
    if kind == "text":
        body = _mapping(message.get("text")).get("body")
        if not isinstance(body, str) or len(body) > 4096 or "\x00" in body:
            raise ValueError("invalid_message_text")
    return {"message_type": kind, "text": body}


def parse_app_change(field, value):
    """Envelope/account validation is performed by the common signed parser."""
    result = []
    if field == "smb_message_echoes":
        for message in _list(value.get("message_echoes", []), limit=MAX_APP_EVENTS):
            message = _mapping(message)
            party = identity(message.get("to"), message.get("to_user_id"))
            result.append(
                _event(
                    "echo",
                    _message_id(message.get("id")),
                    _timestamp(message.get("timestamp")),
                    recipient=party,
                    **_content(message),
                )
            )
    elif field == "smb_app_state_sync":
        for item in _list(value.get("state_sync", []), limit=MAX_APP_EVENTS):
            item = _mapping(item)
            if item.get("type") != "contact":
                continue
            action = item.get("action")
            if action not in {"add", "remove"}:
                raise ValueError("invalid_contact_action")
            contact = _mapping(item.get("contact"))
            party = identity(contact.get("phone_number"), contact.get("user_id"))
            name = contact.get("full_name") or contact.get("first_name")
            if action == "remove":
                name = None
            elif not isinstance(name, str) or len(name) > 256 or any(ord(c) < 32 for c in name):
                raise ValueError("invalid_contact_name")
            mid = (
                "wamid.contact."
                + hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()
            )
            result.append(
                _event(
                    "contact",
                    mid,
                    _timestamp(_mapping(item.get("metadata")).get("timestamp")),
                    sender=party,
                    text=name,
                    status=action,
                )
            )
    elif field == "history":
        for history in _list(value.get("history", []), limit=100):
            history = _mapping(history)
            errors = _list(history.get("errors", []), limit=10)
            if errors:
                declined = all(_mapping(err).get("code") == 2593109 for err in errors)
                mid = (
                    "wamid.sync."
                    + hashlib.sha256(json.dumps(history, sort_keys=True).encode()).hexdigest()
                )
                result.append(
                    _event(
                        "sync",
                        mid,
                        datetime.fromtimestamp(0, UTC),
                        status="declined" if declined else "review_required",
                    )
                )
                continue
            meta = _mapping(history.get("metadata"))
            progress = meta.get("progress")
            if (
                type(progress) is not int
                or not 0 <= progress <= 100
                or type(meta.get("phase")) is not int
                or meta["phase"] not in {0, 1, 2}
                or type(meta.get("chunk_order")) is not int
                or meta["chunk_order"] < 0
            ):
                raise ValueError("invalid_history_progress")
            for thread in _list(history.get("threads", []), limit=MAX_APP_EVENTS):
                thread = _mapping(thread)
                context = _mapping(thread.get("context", {}))
                party = identity(context.get("wa_id") or thread.get("id"), context.get("user_id"))
                for message in _list(thread.get("messages", []), limit=MAX_APP_EVENTS):
                    message = _mapping(message)
                    # `to` is only present for business messages. Otherwise prove
                    # direction from the exact business number or user identity.
                    outgoing = message.get("to") is not None
                    if outgoing:
                        if identity(message["to"]) != party:
                            raise ValueError("history_party_mismatch")
                    elif message.get("from") is not None and identity(
                        message.get("from")
                    ) == identity(value["metadata"].get("display_phone_number")):
                        outgoing = True
                    elif identity(message.get("from"), message.get("from_user_id")) != party:
                        raise ValueError("history_party_mismatch")
                    status = _mapping(message.get("history_context", {})).get("status", "sent")
                    result.append(
                        _event(
                            "history_out" if outgoing else "history_in",
                            _message_id(message.get("id")),
                            _timestamp(message.get("timestamp")),
                            sender=party if not outgoing else None,
                            recipient=party if outgoing else None,
                            status=status
                            if status in {"sent", "delivered", "read", "failed"}
                            else "sent",
                            **_content(message),
                        )
                    )
                    if len(result) > MAX_APP_EVENTS:
                        raise ValueError("too_many_events")
            # Process progress only AFTER this chunk's messages commit.
            mid = (
                "wamid.sync."
                + hashlib.sha256(json.dumps(meta, sort_keys=True).encode()).hexdigest()
            )
            result.append(
                _event(
                    "sync",
                    mid,
                    datetime.fromtimestamp(0, UTC),
                    status="completed" if progress == 100 else "requested",
                    progress=progress,
                )
            )
    return result

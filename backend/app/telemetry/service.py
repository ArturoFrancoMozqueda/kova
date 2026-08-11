"""Server-authored funnel events.

Some funnel rungs must not be assertable by the client. ``signup_completed`` is
the clearest case: it is the number every acquisition decision keys on, and when
the browser owned it the production table filled with events that never
corresponded to an account (48 events vs. 2 real accounts in a 30-day window —
``docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md``).

Writing it here, from inside the request that actually created the tenant, makes
the event true by construction: no account, no event.
"""
from __future__ import annotations

import logging
import re
from uuid import uuid4

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.telemetry.models import ANONYMOUS_INGEST_SERVER, AnonymousTelemetryEvent

logger = logging.getLogger(__name__)

# Mirrors ``CLIENT_ID_PATTERN`` in ``app.telemetry.schemas``. The client_id is a
# pseudonymous, browser-generated UUID used only to stitch a landing view to the
# signup it produced; anything that does not match that shape is dropped rather
# than stored.
_CLIENT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$")

_ALLOWED_CONTEXT_KEYS = frozenset(
    {"device_class", "viewport_bucket", "source", "medium", "campaign"}
)


def normalize_client_id(value: str | None) -> str | None:
    """Return `value` if it is a usable pseudonymous client id, else ``None``."""
    if not value:
        return None
    candidate = value.strip()
    if not _CLIENT_ID_PATTERN.fullmatch(candidate):
        return None
    return candidate


def record_signup_completed(
    db: Session,
    *,
    client_id: str | None,
    context: dict[str, str] | None = None,
) -> None:
    """Record the server-side ``signup_completed`` rung. Never raises.

    Telemetry must not be able to fail a signup: the account already exists by
    the time this runs, and a growth metric is not worth a 500 in the user's
    face. Failures are logged and swallowed.

    `client_id` is optional — a visitor with localStorage disabled still gets an
    account, they just cannot be stitched back to their landing view. The event
    is still recorded (with a synthetic id) so the count stays correct.
    """
    stitch_id = normalize_client_id(client_id) or f"server:{uuid4()}"
    properties: dict[str, str] = {"path": "/signup"}
    for key, value in (context or {}).items():
        if key in _ALLOWED_CONTEXT_KEYS and isinstance(value, str):
            properties[key] = value
    try:
        db.add(
            AnonymousTelemetryEvent(
                event_name="signup_completed",
                client_id=stitch_id,
                client_event_id=f"signup_completed:{uuid4()}",
                properties=properties,
                is_trusted=True,
                ingest_source=ANONYMOUS_INGEST_SERVER,
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
    except SQLAlchemyError:
        db.rollback()
        logger.warning("failed to record signup_completed telemetry", exc_info=True)

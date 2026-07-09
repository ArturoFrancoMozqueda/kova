from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db
from app.middleware.rate_limit import rate_limit
from app.shared.dependencies import get_current_session
from app.telemetry.models import AnonymousTelemetryEvent, TelemetryEvent
from app.telemetry.schemas import (
    AnonymousTelemetryEventCreate,
    TelemetryEventCreate,
    TelemetryEventResponse,
)

router = APIRouter(prefix="/api/v1/telemetry", tags=["telemetry"])


@router.post("/events", response_model=TelemetryEventResponse, status_code=202)
def create_event(
    body: TelemetryEventCreate,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
) -> TelemetryEventResponse:
    user, membership, _ = ctx
    db.add(
        TelemetryEvent(
            tenant_id=membership.tenant_id,
            user_id=user.id,
            event_name=body.event_name,
            client_event_id=body.client_event_id,
            properties=body.properties,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return TelemetryEventResponse()


@router.post(
    "/events/anonymous",
    response_model=TelemetryEventResponse,
    status_code=202,
    dependencies=[Depends(rate_limit(30, window_seconds=60, key="telemetry-anon"))],
)
def create_anonymous_event(
    body: AnonymousTelemetryEventCreate,
    db: Session = Depends(get_db),
) -> TelemetryEventResponse:
    """Ingest a single pre-authentication funnel event.

    Deliberately unauthenticated so the landing (no session yet) can record
    ``landing_viewed`` / ``landing_cta_clicked`` / ``signup_started``. Safe
    because: the event type is allowlisted (:data:`ANONYMOUS_EVENT_NAMES`), no
    tenant/user identifiers are accepted, the payload is bounded, and the route
    is per-IP rate-limited. It writes only to the non-tenanted
    ``anonymous_telemetry_events`` table and can never mutate business data.
    The request is cookieless, so it is correctly outside the CSRF path.
    """
    db.add(
        AnonymousTelemetryEvent(
            event_name=body.event_name,
            client_id=body.client_id,
            client_event_id=body.client_event_id,
            properties=body.properties,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Duplicate client_event_id (retry / double-fire) — idempotent no-op.
        db.rollback()
    return TelemetryEventResponse()

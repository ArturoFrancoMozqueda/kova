import hmac
from datetime import UTC, datetime
from enum import IntEnum

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.config import settings
from app.db import get_db, get_privileged_db
from app.middleware.rate_limit import rate_limit
from app.shared.dependencies import get_current_session
from app.shared.exceptions import forbidden
from app.telemetry import export
from app.telemetry.models import AnonymousTelemetryEvent, TelemetryEvent
from app.telemetry.schemas import (
    AnalysisAdoptionReport,
    AnonymousTelemetryEventCreate,
    TelemetryEventCreate,
    TelemetryEventResponse,
)

router = APIRouter(prefix="/api/v1/telemetry", tags=["telemetry"])


class AnalysisWindowDays(IntEnum):
    WEEK = 7
    MONTH = 30


def _violates_constraint(exc: IntegrityError, name: str) -> bool:
    diagnostic = getattr(exc.orig, "diag", None)
    return getattr(diagnostic, "constraint_name", None) == name


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
    except IntegrityError as exc:
        db.rollback()
        if not _violates_constraint(exc, "uq_telemetry_tenant_client_event"):
            raise
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
    ``landing_viewed`` / ``landing_section_viewed`` /
    ``landing_story_step_viewed`` / ``landing_cta_clicked``
    / ``signup_started``. Safe
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
    except IntegrityError as exc:
        # Duplicate client_event_id (retry / double-fire) — idempotent no-op.
        db.rollback()
        if not _violates_constraint(exc, "uq_anon_telemetry_client_event"):
            raise
    return TelemetryEventResponse()


@router.get("/internal/cro-export", include_in_schema=False)
def export_cro_funnel(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: Session = Depends(get_privileged_db),
) -> Response:
    """Operator-only 30-day CSV across anonymous and authenticated events."""
    expected = settings.internal_api_key
    if (
        not expected
        or not x_internal_key
        or not hmac.compare_digest(
            x_internal_key.encode("utf-8"), expected.encode("utf-8")
        )
    ):
        raise forbidden("Invalid or missing internal API key")
    stamp = datetime.now(UTC).date().isoformat()
    return Response(
        content=export.build_cro_export(db, days=30),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="kova-cro-30d-{stamp}.csv"'
        },
    )


@router.get(
    "/internal/analysis-adoption",
    include_in_schema=False,
    response_model=AnalysisAdoptionReport,
)
def analysis_adoption(
    days: AnalysisWindowDays = Query(default=AnalysisWindowDays.WEEK),
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: Session = Depends(get_privileged_db),
) -> AnalysisAdoptionReport:
    """Operator-only aggregate; tenant and user identifiers never leave the server."""
    expected = settings.internal_api_key
    if (
        not expected
        or not x_internal_key
        or not hmac.compare_digest(
            x_internal_key.encode("utf-8"), expected.encode("utf-8")
        )
    ):
        raise forbidden("Invalid or missing internal API key")
    return AnalysisAdoptionReport.model_validate(
        export.build_analysis_adoption_report(db, days=int(days))
    )

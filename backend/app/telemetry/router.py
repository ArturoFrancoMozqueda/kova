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
from app.shared.origin import require_trusted_origin
from app.telemetry import export
from app.telemetry import service as telemetry_service
from app.telemetry.models import AnonymousTelemetryEvent, TelemetryEvent
from app.telemetry.schemas import (
    AnalysisAdoptionReport,
    AnonymousTelemetryEventCreate,
    AnonymousTelemetrySessionCreate,
    AnonymousTelemetrySessionResponse,
    GrowthSnapshot,
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


def _require_internal_key(x_internal_key: str | None) -> None:
    expected = settings.internal_api_key
    if (
        not expected
        or not x_internal_key
        or not hmac.compare_digest(
            x_internal_key.encode("utf-8"), expected.encode("utf-8")
        )
    ):
        raise forbidden("Invalid or missing internal API key")


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
    "/events/anonymous/session",
    response_model=AnonymousTelemetrySessionResponse,
    dependencies=[
        Depends(require_trusted_origin),
        Depends(rate_limit(10, window_seconds=60, key="telemetry-anon-session")),
    ],
)
def create_anonymous_session(
    body: AnonymousTelemetrySessionCreate,
) -> AnonymousTelemetrySessionResponse:
    token, expires_in = telemetry_service.issue_anonymous_session_token(body.client_id)
    return AnonymousTelemetrySessionResponse(token=token, expires_in=expires_in)


@router.post(
    "/events/anonymous",
    response_model=TelemetryEventResponse,
    status_code=202,
    dependencies=[
        Depends(require_trusted_origin),
        Depends(rate_limit(30, window_seconds=60, key="telemetry-anon")),
    ],
)
def create_anonymous_event(
    body: AnonymousTelemetryEventCreate,
    x_kova_anonymous_token: str | None = Header(
        default=None, alias="X-Kova-Anonymous-Token"
    ),
    db: Session = Depends(get_db),
) -> TelemetryEventResponse:
    """Ingest a single pre-authentication funnel event.

    Deliberately outside user authentication so the landing (no session yet) can record
    ``landing_viewed`` / ``landing_section_viewed`` /
    ``landing_story_step_viewed`` / ``landing_cta_clicked``
    / ``signup_started``. Safe
    because: the request must carry a trusted ``Origin`` (see
    :func:`app.shared.origin.require_trusted_origin`), the event type is
    allowlisted (:data:`ANONYMOUS_EVENT_NAMES`), and it must present a
    short-lived signed session bound to the same pseudonymous ``client_id``.
    No tenant/user identifiers are accepted, the payload is bounded, and the
    route is per-IP rate-limited. It
    writes only to the non-tenanted ``anonymous_telemetry_events`` table and can
    never mutate business data. The request is cookieless, so it is correctly
    outside the CSRF path.

    ``signup_completed`` is **not** accepted here: the client may not assert its
    own conversion. The signup route records it server-side.
    """
    telemetry_service.require_anonymous_session_token(
        x_kova_anonymous_token, client_id=body.client_id
    )
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
    _require_internal_key(x_internal_key)
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
    _require_internal_key(x_internal_key)
    return AnalysisAdoptionReport.model_validate(
        export.build_analysis_adoption_report(db, days=int(days))
    )


@router.get(
    "/internal/growth-snapshot",
    include_in_schema=False,
    response_model=GrowthSnapshot,
)
def growth_snapshot(
    x_internal_key: str | None = Header(default=None, alias="X-Internal-Key"),
    db: Session = Depends(get_privileged_db),
) -> GrowthSnapshot:
    """Operator-only acquisition truth; no identities leave the server."""
    _require_internal_key(x_internal_key)
    return GrowthSnapshot.model_validate(export.build_growth_snapshot(db))

from fastapi import APIRouter, Depends
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.db import get_db
from app.shared.dependencies import get_current_session
from app.telemetry.models import TelemetryEvent
from app.telemetry.schemas import TelemetryEventCreate, TelemetryEventResponse

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

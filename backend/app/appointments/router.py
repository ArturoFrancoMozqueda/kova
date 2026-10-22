from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.orm import Session

from app.appointments import service
from app.appointments.schemas import (
    AppointmentCreate,
    AppointmentHistoryList,
    AppointmentList,
    AppointmentReminderList,
    AppointmentReminderResolve,
    AppointmentReminderResponse,
    AppointmentReschedule,
    AppointmentResourceCreate,
    AppointmentResourceList,
    AppointmentResourceResponse,
    AppointmentResourceUpdate,
    AppointmentResponse,
    AppointmentTransition,
)
from app.crm.router import require_crm
from app.db import get_db

router = APIRouter(prefix="/api/v1/appointments", tags=["appointments"])


@router.get("/resources", response_model=AppointmentResourceList)
def resources(db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.resources(db, ctx[1].tenant_id)


@router.post("/resources", response_model=AppointmentResourceResponse, status_code=201)
def create_resource(
    body: AppointmentResourceCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.create_resource(
        db, ctx[1].tenant_id, ctx[0].id, body, key
    )
    return result


@router.patch("/resources/{resource_id}", response_model=AppointmentResourceResponse)
def update_resource(
    resource_id: UUID,
    body: AppointmentResourceUpdate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.update_resource(
        db, ctx[1].tenant_id, ctx[0].id, resource_id, body, key
    )
    return result


@router.get("/reminders", response_model=AppointmentReminderList)
def reminders(
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.reminders(db, ctx[1].tenant_id, limit=limit, offset=offset)


@router.get("/reminders/{reminder_id}", response_model=AppointmentReminderResponse)
def get_reminder(reminder_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.get_reminder(db, ctx[1].tenant_id, reminder_id)


@router.post("/reminders/{reminder_id}/resolve", response_model=AppointmentReminderResponse)
def resolve_reminder(
    reminder_id: UUID,
    body: AppointmentReminderResolve,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.resolve_reminder(
        db, ctx[1].tenant_id, ctx[0].id, reminder_id, body, key
    )
    return result


@router.get("", response_model=AppointmentList)
def appointments(
    starts_from: datetime | None = None,
    starts_until: datetime | None = None,
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.list_appointments(
        db,
        ctx[1].tenant_id,
        starts_from=starts_from,
        starts_until=starts_until,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=AppointmentResponse, status_code=201)
def create_appointment(
    body: AppointmentCreate,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.create_appointment(
        db, ctx[1].tenant_id, ctx[0].id, body, key
    )
    return result


@router.post("/{appointment_id}/reschedule", response_model=AppointmentResponse)
def reschedule(
    appointment_id: UUID,
    body: AppointmentReschedule,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.reschedule(
        db, ctx[1].tenant_id, ctx[0].id, appointment_id, body, key
    )
    return result


@router.post("/{appointment_id}/transition", response_model=AppointmentResponse)
def transition(
    appointment_id: UUID,
    body: AppointmentTransition,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    response.status_code, result = service.transition(
        db, ctx[1].tenant_id, ctx[0].id, appointment_id, body, key
    )
    return result


@router.get("/{appointment_id}/history", response_model=AppointmentHistoryList)
def history(appointment_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.history(db, ctx[1].tenant_id, appointment_id)

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.prep_queue import service
from app.prep_queue.schemas import (
    QueueResponse,
    StationCreate,
    StationResponse,
    StationUpdate,
    TicketStatusChange,
)
from app.rbac.permissions import Permission

router = APIRouter(tags=["prep-queue"])
Ctx = tuple[User, Membership, UserSession]


@router.get("/api/v1/prep-queue", response_model=QueueResponse)
def get_queue(
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    _, membership, _ = ctx
    return service.queue(db, tenant_id=membership.tenant_id)


@router.post("/api/v1/prep-queue/tickets/{ticket_id}/status")
def change_ticket_status(
    ticket_id: UUID,
    body: TicketStatusChange,
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    user, membership, _ = ctx
    return service.change_ticket_status(
        db, tenant_id=membership.tenant_id, user_id=user.id, role=membership.role,
        ticket_id=ticket_id, body=body,
    )


@router.get("/api/v1/prep-stations", response_model=list[StationResponse])
def list_stations(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    _, membership, _ = ctx
    return service.list_stations(
        db, tenant_id=membership.tenant_id, include_inactive=include_inactive
    )


@router.post("/api/v1/prep-stations", response_model=StationResponse, status_code=201)
def create_station(
    body: StationCreate,
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.CATALOG_UPDATE)),
):
    user, membership, _ = ctx
    return service.create_station(db, tenant_id=membership.tenant_id, user_id=user.id, body=body)


@router.patch("/api/v1/prep-stations/{station_id}", response_model=StationResponse)
def update_station(
    station_id: UUID,
    body: StationUpdate,
    db: Session = Depends(get_db),
    ctx: Ctx = Depends(require_commercial_access(Permission.CATALOG_UPDATE)),
):
    user, membership, _ = ctx
    return service.update_station(
        db, tenant_id=membership.tenant_id, user_id=user.id, station_id=station_id, body=body
    )

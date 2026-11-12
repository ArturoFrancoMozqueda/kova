from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.bookings import service
from app.bookings.schemas import (
    AvailabilityWrite,
    BookingReceipt,
    BookingWrite,
    InviteWrite,
    LinkCustomer,
    ManageRead,
    ManageWrite,
    MemberGrant,
    PageWrite,
    PublicContext,
    PublicSlots,
    ServiceWrite,
    StaffBookingReschedule,
    VersionWrite,
)
from app.crm.router import require_crm
from app.db import get_db
from app.middleware.rate_limit import rate_limit
from app.shared.exceptions import forbidden
from app.shared.origin import trusted_origins

router = APIRouter(tags=["bookings"])
PRIVATE = "/api/v1/appointments"
PUBLIC = "/api/v1/public/bookings"


def private_response(response: Response):
    response.headers.update(
        {
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex, nofollow",
        }
    )


def origin(request: Request):
    if request.headers.get("origin", "").strip().lower() not in trusted_origins():
        raise forbidden("Request origin is not allowed")


@router.get(PRIVATE + "/booking-page")
def page(db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.describe_page(service._page(db, ctx[1].tenant_id))


@router.put(PRIVATE + "/booking-page")
def save_page(
    body: PageWrite,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.save_page(db, ctx[1].tenant_id, ctx[0].id, body, key)


@router.get(PRIVATE + "/services")
def services(db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return {"items": service.services(db, ctx[1].tenant_id)}


@router.post(PRIVATE + "/services")
def new_service(
    body: ServiceWrite,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.save_service(db, ctx[1].tenant_id, ctx[0].id, body, key)


@router.put(PRIVATE + "/services/{service_id}")
def update_service(
    service_id: UUID,
    body: ServiceWrite,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.save_service(db, ctx[1].tenant_id, ctx[0].id, body, key, service_id)


@router.get(PRIVATE + "/availability/{resource_id}")
def availability(resource_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.availability(db, ctx[1].tenant_id, resource_id)


@router.put(PRIVATE + "/availability/{resource_id}")
def save_availability(
    resource_id: UUID,
    body: AvailabilityWrite,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.save_availability(db, ctx[1].tenant_id, ctx[0].id, resource_id, body, key)


@router.get(PRIVATE + "/calendar")
def calendar(
    starts_from: datetime,
    starts_until: datetime,
    resource_id: UUID | None = None,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.calendar(db, ctx[1].tenant_id, starts_from, starts_until, resource_id)


@router.get(PRIVATE + "/bookings/{booking_id}")
def booking(booking_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return service.get_booking(db, ctx[1].tenant_id, booking_id)


@router.post(PRIVATE + "/bookings/{booking_id}/customer")
def link(
    booking_id: UUID,
    body: LinkCustomer,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.materialize(db, ctx[1].tenant_id, ctx[0].id, booking_id, body, key)


@router.post(PRIVATE + "/booking-invites")
def invite(
    body: InviteWrite, response: Response, db: Session = Depends(get_db), ctx=Depends(require_crm)
):
    private_response(response)
    return service.invite(db, ctx[1].tenant_id, body.customer_id)


@router.get(
    PUBLIC + "/context",
    response_model=PublicContext,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="booking-context"))],
)
def context(
    response: Response,
    page_token: str = Query(min_length=1, max_length=2000),
    db: Session = Depends(get_db),
):
    private_response(response)
    return service.context(db, page_token)


@router.get(
    PUBLIC + "/slots",
    response_model=PublicSlots,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="booking-slots"))],
)
def slots(
    response: Response,
    page_token: str,
    service_id: UUID,
    resource_id: UUID,
    day: date,
    db: Session = Depends(get_db),
):
    private_response(response)
    page = service.resolve_page(db, page_token)
    return {"items": service.slots(db, page, service_id, resource_id, day)}


@router.post(
    PUBLIC,
    response_model=BookingReceipt,
    status_code=201,
    dependencies=[Depends(rate_limit(10, window_seconds=60, key="booking-create"))],
)
def create(
    body: BookingWrite,
    request: Request,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
):
    origin(request)
    private_response(response)
    return service.create(db, body, key)


@router.post(
    PUBLIC + "/manage/read",
    response_model=BookingReceipt,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="booking-manage-read"))],
)
def read_manage(
    body: ManageRead, request: Request, response: Response, db: Session = Depends(get_db)
):
    origin(request)
    private_response(response)
    page, row = service.resolve_manage(db, body.token)
    return service.receipt(db, page, row)


@router.post(
    PUBLIC + "/manage/slots",
    response_model=PublicSlots,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="booking-manage-slots"))],
)
def manage_slots(
    body: ManageRead, request: Request, response: Response, day: date, db: Session = Depends(get_db)
):
    origin(request)
    private_response(response)
    page, row = service.resolve_manage(db, body.token)
    if not service.receipt(db, page, row)["can_manage"] or not page.enabled:
        return {"items": []}
    return {"items": service.slots(db, page, row.service_id, row.resource_id, day, excluding=row)}


@router.post(
    PUBLIC + "/manage",
    response_model=BookingReceipt,
    dependencies=[Depends(rate_limit(10, window_seconds=60, key="booking-manage"))],
)
def manage(
    body: ManageWrite,
    request: Request,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
):
    origin(request)
    private_response(response)
    return service.manage(db, body, key)


@router.post(
    "/api/v1/public/loyalty/membership/booking-grant",
    dependencies=[Depends(rate_limit(20, window_seconds=60, key="booking-member-grant"))],
)
def member_grant(
    body: MemberGrant, request: Request, response: Response, db: Session = Depends(get_db)
):
    origin(request)
    private_response(response)
    return service.member_grant(db, request, body)


@router.post(PRIVATE + "/bookings/{booking_id}/cancel")
def cancel_booking(
    booking_id: UUID,
    body: VersionWrite,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.staff_action(db, ctx[1].tenant_id, ctx[0].id, booking_id, body, key)


@router.post(PRIVATE + "/bookings/{booking_id}/revoke")
def revoke_booking(
    booking_id: UUID,
    body: VersionWrite,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.staff_action(db, ctx[1].tenant_id, ctx[0].id, booking_id, body, key, revoke=True)


@router.post(PRIVATE + "/bookings/{booking_id}/reschedule")
def reschedule_booking(
    booking_id: UUID,
    body: StaffBookingReschedule,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return service.staff_reschedule(db, ctx[1].tenant_id, ctx[0].id, booking_id, body, key)

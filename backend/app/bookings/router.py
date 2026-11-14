from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.bookings import service, tables
from app.bookings.schemas import (
    AvailabilityWrite,
    BookingPreview,
    BookingPreviewRequest,
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
    TableAction,
    TableArrivals,
    TableDetail,
    TableList,
    TableReceipt,
    TableRequestWrite,
    TableStatus,
    VersionWrite,
)
from app.crm.router import require_agenda, require_crm
from app.db import get_db
from app.middleware.rate_limit import rate_limit
from app.shared.exceptions import forbidden, not_found
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


@router.post(PRIVATE + "/booking-preview", response_model=BookingPreview)
def booking_preview(
    body: BookingPreviewRequest,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    """Owner preview of the public booking page for unsaved settings. Read-only."""
    private_response(response)
    return service.preview(db, ctx[1].tenant_id, body)


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
    ctx=Depends(require_agenda),
):
    return service.calendar(db, ctx[1].tenant_id, starts_from, starts_until, resource_id)


@router.get(PRIVATE + "/bookings/{booking_id}")
def booking(booking_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_agenda)):
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
    if page.mode != "appointments":
        raise not_found(service.UNAVAILABLE)
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
    ctx=Depends(require_agenda),
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
    ctx=Depends(require_agenda),
):
    return service.staff_reschedule(db, ctx[1].tenant_id, ctx[0].id, booking_id, body, key)


@router.get(PRIVATE + "/table-reservations", response_model=TableList)
def list_tables(
    status: TableStatus | None = None,
    starts_from: datetime | None = None,
    starts_until: datetime | None = None,
    resource_id: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return tables.listing(
        db,
        ctx[1].tenant_id,
        status=status,
        start=starts_from,
        end=starts_until,
        resource_id=resource_id,
        limit=limit,
        offset=offset,
    )


@router.get(PRIVATE + "/table-reservations/{reservation_id}", response_model=TableDetail)
def table_detail(reservation_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)):
    return tables.detail(db, ctx[1].tenant_id, reservation_id)


@router.get(PRIVATE + "/table-reservations/{reservation_id}/review", response_model=TableList)
def table_review(
    reservation_id: UUID, resource_id: UUID, db: Session = Depends(get_db), ctx=Depends(require_crm)
):
    return tables.review(db, ctx[1].tenant_id, reservation_id, resource_id)


@router.post(PRIVATE + "/table-reservations/{reservation_id}/action", response_model=TableDetail)
def table_action(
    reservation_id: UUID,
    body: TableAction,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_crm),
):
    return tables.act(db, ctx[1].tenant_id, ctx[0].id, reservation_id, body, key)


@router.get(
    PUBLIC + "/table-arrivals",
    response_model=TableArrivals,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="table-arrivals"))],
)
def table_arrivals(
    response: Response,
    page_token: str = Query(min_length=1, max_length=2000),
    day: date = Query(),
    db: Session = Depends(get_db),
):
    private_response(response)
    return {"items": tables.arrivals(db, service.resolve_page(db, page_token), day)}


@router.post(
    PUBLIC + "/table-requests",
    response_model=TableReceipt,
    status_code=201,
    dependencies=[Depends(rate_limit(10, window_seconds=60, key="table-create"))],
)
def request_table(
    body: TableRequestWrite,
    request: Request,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
):
    origin(request)
    private_response(response)
    return tables.create(db, body, key)


@router.post(
    PUBLIC + "/table-manage/read",
    response_model=TableReceipt,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="table-read"))],
)
def read_table(
    body: ManageRead, request: Request, response: Response, db: Session = Depends(get_db)
):
    origin(request)
    private_response(response)
    page, row = tables.resolve_manage(db, body.token)
    return tables.receipt(db, page, row)


@router.post(
    PUBLIC + "/table-manage/arrivals",
    response_model=TableArrivals,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="table-manage-arrivals"))],
)
def manage_table_arrivals(
    body: ManageRead, request: Request, response: Response, day: date, db: Session = Depends(get_db)
):
    origin(request)
    private_response(response)
    page, row = tables.resolve_manage(db, body.token)
    if not tables.receipt(db, page, row)["can_manage"]:
        from app.shared.exceptions import conflict

        raise conflict("Para cambiar esta solicitud, contacta al negocio.")
    return {"items": tables.arrivals(db, page, day)}


@router.post(
    PUBLIC + "/table-manage",
    response_model=TableReceipt,
    dependencies=[Depends(rate_limit(20, window_seconds=60, key="table-manage"))],
)
def manage_table(
    body: ManageWrite,
    request: Request,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
):
    origin(request)
    private_response(response)
    return tables.manage(db, body, key)

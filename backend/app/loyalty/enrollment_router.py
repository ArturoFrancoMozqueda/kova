from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.billing.access import require_commercial_access
from app.db import get_db
from app.loyalty import enrollment
from app.loyalty.router import require_loyalty
from app.loyalty.schemas import (
    EnrollmentPolicyResponse,
    EnrollmentPolicyWrite,
    EnrollmentReceipt,
    MemberCodeRead,
    MemberResolution,
    MembershipContext,
    PublicEnrollmentWrite,
)
from app.middleware.rate_limit import rate_limit
from app.rbac.permissions import Permission, has_permission
from app.shared.exceptions import forbidden
from app.shared.origin import trusted_origins

router = APIRouter(tags=["loyalty"])


def _private(response):
    response.headers.update(
        {
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex, nofollow",
        }
    )


@router.get("/api/v1/loyalty/enrollment-policy", response_model=EnrollmentPolicyResponse)
def read_policy(db: Session = Depends(get_db), ctx=Depends(require_loyalty)):
    return enrollment.policy(db, ctx[1].tenant_id)


@router.put("/api/v1/loyalty/enrollment-policy", response_model=EnrollmentPolicyResponse)
def save_policy(
    body: EnrollmentPolicyWrite,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
    ctx=Depends(require_loyalty),
):
    response.status_code, result = enrollment.save_policy(
        db, ctx[1].tenant_id, ctx[0].id, body, key
    )
    return result


@router.get(
    "/api/v1/public/loyalty/membership",
    response_model=MembershipContext,
    dependencies=[Depends(rate_limit(60, window_seconds=60, key="public-membership"))],
)
def membership(
    request: Request,
    response: Response,
    menu: str = Query(min_length=1, max_length=1500),
    key: str | None = Header(None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
):
    _private(response)
    catalog = enrollment.resolve_program(db, menu)
    return enrollment.context(db, catalog, request, response, key)


@router.post(
    "/api/v1/public/loyalty/membership/enroll",
    response_model=EnrollmentReceipt,
    status_code=201,
    dependencies=[Depends(rate_limit(10, window_seconds=60, key="public-member-enroll"))],
)
def enroll(
    body: PublicEnrollmentWrite,
    request: Request,
    response: Response,
    key: str | None = Header(None, alias="Idempotency-Key"),
    grant: str | None = Header(None, alias="X-Kova-Member-CSRF"),
    db: Session = Depends(get_db),
):
    _private(response)
    if request.headers.get("origin", "").strip().lower() not in trusted_origins():
        raise forbidden("Request origin is not allowed")
    catalog = enrollment.resolve_program(db, body.menu_token)
    return enrollment.enroll(db, catalog, request, response, body, key, grant)


@router.post(
    "/api/v1/loyalty/members/resolve",
    response_model=MemberResolution,
    dependencies=[Depends(rate_limit(30, window_seconds=60, key="member-resolve"))],
)
def resolve_member(
    body: MemberCodeRead,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(require_commercial_access(Permission.ORDERS_CREATE)),
):
    if not has_permission(ctx[1].role, Permission.CUSTOMERS_VIEW):
        raise forbidden()
    _private(response)
    return enrollment.resolve_code(db, ctx[1].tenant_id, body.code)

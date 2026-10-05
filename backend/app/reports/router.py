from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.branches.reports import BranchComparisonResponse, compare_branches
from app.db import get_db
from app.rbac.permissions import Permission
from app.reports import service
from app.reports.schemas import (
    BusinessStoryReportResponse,
    PaymentBreakdownResponse,
    RefundsByReasonRow,
    SalesByEmployeeRow,
    SalesByHourRow,
    SalesSummaryResponse,
    TopProductsResponse,
)

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("/sales-summary", response_model=SalesSummaryResponse)
def sales_summary(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return service.sales_summary(
        db, tenant_id=membership.tenant_id, start_date=start_date, end_date=end_date
    )


@router.get("/business-story", response_model=BusinessStoryReportResponse)
def business_story(
    start_date: date | None = None,
    end_date: date | None = None,
    start: date | None = None,  # deprecated alias
    end: date | None = None,  # deprecated alias
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return service.business_story(
        db,
        tenant_id=membership.tenant_id,
        start_date=start_date or start,
        end_date=end_date or end,
    )


@router.get("/payment-breakdown", response_model=PaymentBreakdownResponse)
def payment_breakdown(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return service.payment_breakdown(
        db, tenant_id=membership.tenant_id, start_date=start_date, end_date=end_date
    )


@router.get("/top-products", response_model=TopProductsResponse)
def top_products(
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(default=5, ge=1, le=50),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return service.top_products(
        db,
        tenant_id=membership.tenant_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
    )


@router.get("/sales-by-hour", response_model=list[SalesByHourRow])
def sales_by_hour(
    start_date: date | None = None,
    end_date: date | None = None,
    start: date | None = None,  # deprecated alias
    end: date | None = None,  # deprecated alias
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return service.sales_by_hour(
        db,
        tenant_id=membership.tenant_id,
        start_date=start_date or start,
        end_date=end_date or end,
    )


@router.get("/sales-by-employee", response_model=list[SalesByEmployeeRow])
def sales_by_employee(
    start_date: date | None = None,
    end_date: date | None = None,
    start: date | None = None,  # deprecated alias
    end: date | None = None,  # deprecated alias
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return service.sales_by_employee(
        db,
        tenant_id=membership.tenant_id,
        start_date=start_date or start,
        end_date=end_date or end,
    )


@router.get("/refunds-by-reason", response_model=list[RefundsByReasonRow])
def refunds_by_reason(
    start_date: date | None = None,
    end_date: date | None = None,
    start: date | None = None,  # deprecated alias
    end: date | None = None,  # deprecated alias
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return service.refunds_by_reason(
        db,
        tenant_id=membership.tenant_id,
        start_date=start_date or start,
        end_date=end_date or end,
    )


@router.get("/branches", response_model=BranchComparisonResponse)
def branch_comparison(
    start_date: date | None = None,
    end_date: date | None = None,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.REPORTS_VIEW_ALL)
    ),
):
    _, membership, _ = ctx
    return compare_branches(
        db, tenant_id=membership.tenant_id, start_date=start_date, end_date=end_date
    )

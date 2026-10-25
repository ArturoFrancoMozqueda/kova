"""One authorized dashboard read, reusing the existing report definitions."""

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import Membership
from app.billing import service as billing_service
from app.billing.schemas import BillingSubscriptionResponse
from app.branches.models import Branch
from app.branches.scope import active_branch_id, bind_branch, tenant_wide_branches
from app.business_settings.models import BusinessProfile
from app.catalog.models import Product
from app.employees import service as employee_service
from app.inventory import service as inventory_service
from app.inventory.schemas import InventoryStockItem
from app.onboarding import service as onboarding_service
from app.onboarding.schemas import OnboardingStateResponse
from app.rbac.permissions import Permission, has_permission
from app.reports import service
from app.reports.control import read_control
from app.reports.control_schemas import ControlScope, DashboardControl
from app.reports.presentation import business_story_copy
from app.reports.schemas import BusinessStoryReportResponse, SalesByHourRow, SalesSummaryResponse
from app.shared.timezone import tenant_timezone
from app.shifts import repository as shift_repository

DashboardPeriod = Literal["day", "week", "month"]


class DashboardOverviewResponse(BaseModel):
    story: BusinessStoryReportResponse
    hourly: list[SalesByHourRow]
    previous_summary: SalesSummaryResponse
    timezone: str
    active_catalog_count: int = Field(ge=0)
    tracked_inventory_count: int = Field(ge=0)
    low_stock_items: list[InventoryStockItem]
    active_employee_count: int | None = Field(ge=0)
    closed_shift_count: int = Field(ge=0, le=50)
    billing: BillingSubscriptionResponse | None
    onboarding: OnboardingStateResponse
    control_center: DashboardControl | None = None


def overview(
    db: Session,
    *,
    membership: Membership,
    period: DashboardPeriod,
    branch_id: UUID | Literal["all"] | None = None,
):
    if branch_id is None:
        return _overview(db, membership=membership, period=period)
    tenant, role, allowed = membership.tenant_id, membership.role, membership.allowed_branch_id
    # Scalars survive the existing onboarding commit without one reload per branch.
    options_query = db.query(Branch.id, Branch.name).filter(Branch.tenant_id == tenant)
    if allowed is not None:
        options_query = options_query.filter(Branch.id == allowed)
    options = options_query.order_by(Branch.name, Branch.id).all()
    original = active_branch_id(db, tenant)
    with tenant_wide_branches(db):
        selected = allowed if branch_id == "all" else branch_id
        if selected is not None:
            bind_branch(db, tenant_id=tenant, branch_id=selected)
        scope = ControlScope(
            kind="all" if selected is None else "branch",
            branch_id=selected,
            label="Todas las sucursales"
            if selected is None
            else next(branch.name for branch in options if branch.id == selected),
            can_view_all=allowed is None,
        )
        result = _overview(db, membership=membership, period=period)
        result.control_center = read_control(
            db,
            tenant=tenant,
            role=role,
            branches=[branch.id for branch in options if selected is None or branch.id == selected],
            options=options,
            scope=scope,
            story=result.story,
            now=datetime.now().astimezone(),
            billing=result.billing,
            catalog_count=result.active_catalog_count,
            employee_count=result.active_employee_count,
        )
    # tenant_wide_branches restores the original operating scope, including on failure.
    assert active_branch_id(db, tenant) == original
    return result


def _overview(db: Session, *, membership: Membership, period: DashboardPeriod):
    # Capture ownership before existing onboarding/billing helpers may commit.
    tenant_id, role = membership.tenant_id, membership.role
    billing = None
    if has_permission(role, Permission.BILLING_VIEW):
        billing = BillingSubscriptionResponse.model_validate(
            billing_service.get_subscription_status(db, tenant_id=tenant_id, resync=True)
        )
    # Keep the profile in the identity map while report helpers resolve the same
    # tenant timezone. No cache or request state survives this DB session.
    profile = db.get(BusinessProfile, tenant_id)
    tz = tenant_timezone(db, tenant_id=tenant_id)
    today = datetime.now(tz).date()
    days = {"day": 1, "week": 7, "month": 30}[period]
    start = today - timedelta(days=days - 1)
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=days - 1)
    story = BusinessStoryReportResponse.model_validate(
        business_story_copy(
            service.business_story(
                db,
                tenant_id=tenant_id,
                start_date=start,
                end_date=today,
            )
        )
    )
    previous = SalesSummaryResponse.model_validate(
        service.sales_summary(
            db,
            tenant_id=tenant_id,
            start_date=previous_start,
            end_date=previous_end,
        )
    )
    hourly = service.sales_by_hour(db, tenant_id=tenant_id, start_date=start, end_date=today)
    stock = inventory_service.list_stock(db, tenant_id=tenant_id)
    low_stock = [InventoryStockItem.model_validate(item) for item in stock if item["is_low_stock"]]
    active_catalog_count = (
        db.query(func.count(Product.id))
        .filter(
            Product.tenant_id == tenant_id,
            Product.is_active.is_(True),
        )
        .scalar()
    )
    active_employee_count = None
    if has_permission(role, Permission.USERS_MANAGE):
        active_employee_count = sum(
            employee["is_active"]
            for employee in employee_service.list_employees(db, tenant_id=tenant_id)
        )
    # /shifts returns the latest fifty closed shifts. Preserve that count without
    # calculating every drawer's monetary reconciliation just to count its row.
    closed_shift_count = len(shift_repository.list_closed_shifts(db, tenant_id=tenant_id))
    # This existing helper refreshes and persists the same onboarding snapshot.
    # Run it last so its commit cannot expire ORM values while building reports.
    onboarding = OnboardingStateResponse.model_validate(
        onboarding_service.get_onboarding_state(db, tenant_id=tenant_id)
    )
    del profile
    return DashboardOverviewResponse(
        story=story,
        hourly=hourly,
        previous_summary=previous,
        timezone=str(tz),
        active_catalog_count=active_catalog_count,
        tracked_inventory_count=len(stock),
        low_stock_items=low_stock,
        active_employee_count=active_employee_count,
        closed_shift_count=closed_shift_count,
        billing=billing,
        onboarding=onboarding,
    )

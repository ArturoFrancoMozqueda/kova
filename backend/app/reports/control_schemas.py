"""Read-only owner supervision, separate from the operating drawer's branch."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

AreaKey = Literal["sales", "products", "customers", "attention", "money", "business"]
RouteKey = Literal[
    "orders",
    "shifts",
    "customer_orders",
    "quotes",
    "inventory",
    "purchasing",
    "replenishment",
    "customers",
    "crm",
    "commercial_requests",
    "followups",
    "loyalty",
    "appointments",
    "service_cases",
    "inbox",
    "reports",
    "expenses",
    "reconciliation",
    "automations",
    "channels",
    "integrations",
    "billing",
    "settings",
    "public_catalog",
]


class ControlBranch(BaseModel):
    id: UUID
    name: str


class ControlScope(BaseModel):
    kind: Literal["all", "branch"]
    branch_id: UUID | None
    label: str
    can_view_all: bool


class ControlMetric(BaseModel):
    key: str
    label: str
    value: str | None
    format: Literal["count", "money", "text"] = "count"
    scope: Literal["current", "period", "today", "business"] = "current"
    route_key: RouteKey
    detail: str | None = None


class ControlArea(BaseModel):
    key: AreaKey
    status: Literal["ready", "unavailable"] = "ready"
    metrics: list[ControlMetric]


class ControlAlert(BaseModel):
    key: str
    branch_id: UUID
    branch_name: str
    title: str
    count: int = Field(gt=0)
    priority: Literal["now", "today", "followup"]
    route_key: RouteKey
    scope: Literal["current", "period", "today"] = "current"


class ControlBranchSales(BaseModel):
    branch_id: UUID
    branch_name: str
    completed_orders: int
    net_sales: str
    average_ticket: str
    share_pct: str
    low_stock_count: int | None = None
    open_shift_count: int | None = None
    attention_signals: int


class DashboardControl(BaseModel):
    generated_at: datetime
    scope: ControlScope
    branches: list[ControlBranch]
    branch_sales: list[ControlBranchSales]
    areas: list[ControlArea]
    alerts: list[ControlAlert]
    alert_groups_total: int
    priority_counts: dict[Literal["now", "today", "followup"], int]
    alerts_has_more: bool

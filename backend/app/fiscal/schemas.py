from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Frequency = Literal["daily", "weekly", "monthly"]


class FiscalGlobalDraftSettingsUpsert(BaseModel):
    frequency: Frequency
    weekly_close_day: int = Field(default=7, ge=1, le=7)
    monthly_close_day: int = Field(default=31, ge=1, le=31)
    auto_close_enabled: bool = False


class FiscalGlobalDraftSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    frequency: Frequency
    weekly_close_day: int
    monthly_close_day: int
    auto_close_enabled: bool
    timezone: Literal["America/Mexico_City"] = "America/Mexico_City"
    scheduler_status: Literal["active"] = "active"


class FiscalGlobalDraftClose(BaseModel):
    period_end: date


class FiscalGlobalDraftPreviewResponse(BaseModel):
    frequency: Frequency
    period_start: date
    period_end: date
    timezone: Literal["America/Mexico_City"] = "America/Mexico_City"
    document_kind: Literal["operational_draft"] = "operational_draft"
    fiscal_status: Literal["not_issued"] = "not_issued"
    gross_amount: Decimal
    discount_total_amount: Decimal
    tax_total_amount: Decimal
    total_amount: Decimal
    refund_total_amount: Decimal
    net_total_amount: Decimal
    order_count: int
    excluded_individually_confirmed_count: int


class FiscalGlobalDraftBatchResponse(FiscalGlobalDraftPreviewResponse):
    id: UUID
    status: Literal["draft", "closed"]
    order_ids: list[UUID]
    closed_at: datetime


class FiscalGlobalDraftBatchListResponse(BaseModel):
    items: list[FiscalGlobalDraftBatchResponse]
    total: int


class FiscalAutoCloseRequest(BaseModel):
    tenant_limit: int = Field(default=100, ge=1, le=500)
    periods_per_tenant: int = Field(default=31, ge=1, le=366)


class FiscalAutoCloseResponse(BaseModel):
    tenants_examined: int
    batches_created: int
    batches_replayed: int
    periods_skipped_empty: int
    failures: int

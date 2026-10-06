from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class FiscalIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    rfc: str = Field(pattern=r"^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$")
    legal_name: str = Field(min_length=1, max_length=180)
    postal_code: str = Field(pattern=r"^[0-9]{5}$")
    tax_regime: str = Field(pattern=r"^[0-9]{3}$")

    @field_validator("rfc", mode="before")
    @classmethod
    def normalize_rfc(cls, value):
        return value.strip().upper() if isinstance(value, str) else value


class InvoiceRecipient(FiscalIdentity):
    cfdi_use: str = Field(pattern=r"^[A-Z][0-9]{2}$")
    email: EmailStr


class InvoiceRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    order_id: UUID
    recipient: InvoiceRecipient


class InvoiceRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    order_id: UUID
    status: Literal["pending_provider"]
    issuer_snapshot: FiscalIdentity
    pricing_snapshot: dict[str, str]
    recipient_snapshot: InvoiceRecipient
    total_amount: Decimal
    created_at: datetime
    fiscal_status: Literal["not_issued"] = "not_issued"


class ReadinessResponse(BaseModel):
    cfdi_status: Literal[
        "not_connected", "test_connected", "live_not_ready", "live_ready"
    ] = "not_connected"
    terminal_status: Literal["not_connected"] = "not_connected"
    can_issue_cfdi: bool = False
    can_charge_terminal: Literal[False] = False
    issuer: FiscalIdentity | None
    validation_scope: Literal["format_only"] = "format_only"

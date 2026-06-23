from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.shared.validation import StrictModel


class ShiftOpenCreate(StrictModel):
    opening_cash_amount: Decimal | None = Field(
        default=None, ge=0, max_digits=12, decimal_places=2
    )


class CashMovementCreate(StrictModel):
    type: str = Field(pattern="^(cash_in|cash_out)$")
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    reason: str = Field(min_length=1, max_length=255)


class ShiftCloseCreate(StrictModel):
    actual_cash_amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class CashMovementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shift_id: UUID
    type: str
    amount: Decimal
    reason: str
    created_at: datetime


class ShiftResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    status: str
    opening_cash_amount: Decimal | None
    actual_cash_amount: Decimal | None
    expected_cash_amount: Decimal | None
    reconciliation_status: str | None
    variance_amount: Decimal | None
    opened_at: datetime
    closed_at: datetime | None
    movements: list[CashMovementResponse] = Field(default_factory=list)

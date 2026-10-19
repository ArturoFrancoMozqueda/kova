from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.shared.validation import StrictModel, reject_html


class LoyaltyPolicyWrite(StrictModel):
    expected_version: int = Field(ge=0)
    enabled: bool
    spend_amount: Decimal = Field(
        ge=Decimal(".01"), le=Decimal("1000000"), max_digits=12, decimal_places=2
    )
    points_per_step: int = Field(ge=1, le=10000)


class LoyaltyPolicyResponse(BaseModel):
    enabled: bool
    spend_amount: Decimal | None
    points_per_step: int | None
    version: int


class LoyaltyAccountSummary(BaseModel):
    customer_id: UUID
    customer_name: str
    balance: int


class LoyaltyEntryResponse(BaseModel):
    id: UUID
    kind: Literal["accrual", "refund", "void", "redemption"]
    points: int
    sale_order_id: UUID | None
    benefit: str | None
    created_at: datetime


class LoyaltyAccountResponse(LoyaltyAccountSummary):
    adjustments_pending: bool
    entries: list[LoyaltyEntryResponse]
    has_more: bool


class LoyaltyOverview(BaseModel):
    policy: LoyaltyPolicyResponse
    accounts: list[LoyaltyAccountSummary]
    accounts_has_more: bool


class LoyaltyRedeemWrite(StrictModel):
    points: int = Field(ge=1, le=1000000000)
    expected_balance: int
    benefit: str = Field(min_length=1, max_length=300)
    confirmed: Literal[True]

    @field_validator("benefit")
    @classmethod
    def plain_text(cls, value):
        value = value.strip()
        reject_html(value)
        if not value:
            raise ValueError("Describe el beneficio que revisarás de forma manual")
        return value


class LoyaltyProcessResponse(BaseModel):
    created: int

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
    kind: Literal["accrual", "refund", "void", "redemption", "reward_return"]
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


class DigitalCardLink(BaseModel):
    share_path: str
    expires_at: datetime


class PublicCardRead(StrictModel):
    token: str


class PublicLoyaltyCard(BaseModel):
    business_name: str
    branch_name: str
    balance: int
    adjustments_pending: bool
    policy: LoyaltyPolicyResponse
    expires_at: datetime
    catalog_path: str | None
    reward: "LoyaltyRewardResponse | None" = None


class LoyaltyRewardWrite(StrictModel):
    expected_version: int = Field(ge=0)
    enabled: bool
    title: str = Field(min_length=1, max_length=160)
    points_cost: int = Field(ge=1, le=1000000000)
    discount_amount: Decimal = Field(
        ge=Decimal(".01"),
        le=Decimal("1000000"),
        max_digits=12,
        decimal_places=2,
    )

    @field_validator("title")
    @classmethod
    def plain_title(cls, value):
        value = value.strip()
        reject_html(value)
        if not value:
            raise ValueError("Describe el beneficio de esta recompensa")
        return value


class LoyaltyRewardResponse(BaseModel):
    id: UUID
    version: int
    enabled: bool
    title: str
    points_cost: int
    discount_amount: Decimal


class LoyaltyRewardOffer(BaseModel):
    customer_id: UUID
    balance: int
    adjustments_pending: bool
    reward: LoyaltyRewardResponse | None


from app.orders.schemas import OrderCreate  # noqa: E402


class LoyaltyRewardCheckout(StrictModel):
    order: OrderCreate
    reward_id: UUID
    reward_version: int = Field(ge=1)
    expected_balance: int
    confirmed: Literal[True]


PublicLoyaltyCard.model_rebuild()


class EnrollmentPolicyWrite(StrictModel):
    enabled: bool
    expected_version: int = Field(ge=0)


class EnrollmentPolicyResponse(BaseModel):
    enabled: bool
    version: int


class MemberCard(PublicLoyaltyCard):
    member_code: str
    member_qr_data_url: str | None = None


class MembershipContext(BaseModel):
    available: bool
    enrolled: bool
    business_name: str
    branch_name: str
    policy: LoyaltyPolicyResponse
    reward: LoyaltyRewardResponse | None
    csrf_token: str | None
    card: MemberCard | None
    card_path: str


class PublicEnrollmentWrite(StrictModel):
    menu_token: str = Field(min_length=1, max_length=1500)
    name: str = Field(min_length=1, max_length=80)
    confirmed: Literal[True]

    @field_validator("name")
    @classmethod
    def plain_name(cls, value):
        value = value.strip()
        reject_html(value)
        if not value:
            raise ValueError("Escribe tu nombre o apodo para la tarjeta")
        return value


class EnrollmentReceipt(BaseModel):
    card: MemberCard
    card_path: str


class MemberCodeRead(StrictModel):
    code: str = Field(min_length=1, max_length=100)


class MemberCustomer(BaseModel):
    id: UUID
    name: str
    is_active: bool


class MemberResolution(BaseModel):
    customer: MemberCustomer

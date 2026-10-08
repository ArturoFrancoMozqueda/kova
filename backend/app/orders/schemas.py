from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.inventory.lot_schemas import LotAllocation, LotHistoryAllocation
from app.shared.validation import (
    MAX_MODIFIER_OPTIONS,
    MAX_ORDER_ITEMS,
    MAX_PAYMENTS,
    MAX_REFUND_ITEMS,
)

# NOTE: Order request schemas intentionally stay on BaseModel (not StrictModel):
# the offline queue may replay payloads from older app bundles that carry extra
# fields, and silently dropping queued sales is not acceptable. They are still
# bounded by collection-size caps below.


class OrderItemCreate(BaseModel):
    lot_allocations: list[LotAllocation] | None = Field(default=None, max_length=100)
    unit_price_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    product_id: UUID
    quantity: int = Field(gt=0)
    modifier_option_ids: list[UUID] = Field(default_factory=list, max_length=MAX_MODIFIER_OPTIONS)


class PaymentCreate(BaseModel):
    method: str = Field(pattern="^(cash|bank_transfer|manual_card)$")
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    amount_tendered: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    reference: str | None = Field(default=None, max_length=255)


class OrderCreate(BaseModel):
    customer_id: UUID | None = None
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    tax_rate: Decimal = Field(default=Decimal("0.00"), ge=0, le=100, max_digits=5, decimal_places=2)
    items: list[OrderItemCreate] = Field(min_length=1, max_length=MAX_ORDER_ITEMS)
    payments: list[PaymentCreate] = Field(min_length=1, max_length=MAX_PAYMENTS)


class OrderItemModifierResponse(BaseModel):
    modifier_group_name: str
    modifier_option_name: str
    price_delta_amount: Decimal


class OrderItemResponse(BaseModel):
    lot_tracked: bool = False
    lot_allocations: list[LotHistoryAllocation] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal
    modifiers: list[OrderItemModifierResponse] = Field(default_factory=list)


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    method: str
    amount_amount: Decimal
    amount_tendered_amount: Decimal | None
    change_due_amount: Decimal
    reference: str | None


class OrderResponse(BaseModel):
    customer_id: UUID | None = None
    discount_amount: Decimal = Decimal("0.00")
    tax_rate: Decimal = Decimal("0.00")
    tax_amount: Decimal = Decimal("0.00")
    branch_id: UUID
    id: UUID
    tenant_id: UUID
    status: str
    subtotal_amount: Decimal
    total_amount: Decimal
    items: list[OrderItemResponse]
    payments: list[PaymentResponse]


class ReceiptItemLine(BaseModel):
    product_name: str
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal
    modifiers: list[OrderItemModifierResponse] = Field(default_factory=list)


class ReceiptPaymentLine(BaseModel):
    method: str
    amount_amount: Decimal
    amount_tendered_amount: Decimal | None
    change_due_amount: Decimal
    reference: str | None


class ReceiptRefundItemLine(BaseModel):
    order_item_id: UUID
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal


class ReceiptRefundLine(BaseModel):
    id: UUID
    reason: str
    refunded_amount: Decimal
    created_at: datetime
    items: list[ReceiptRefundItemLine]


class ReceiptVoidLine(BaseModel):
    id: UUID
    reason: str
    created_at: datetime


class ReceiptResponse(BaseModel):
    discount_amount: Decimal = Decimal("0.00")
    tax_rate: Decimal = Decimal("0.00")
    tax_amount: Decimal = Decimal("0.00")
    order_id: UUID
    receipt_number: str
    tenant_name: str
    paper_width_mm: Literal[58, 80] = 80
    created_at: datetime
    status: str
    items: list[ReceiptItemLine]
    subtotal_amount: Decimal
    total_amount: Decimal
    payments: list[ReceiptPaymentLine]
    total_tendered: Decimal
    total_change: Decimal
    refunds: list[ReceiptRefundLine] = Field(default_factory=list)
    void: ReceiptVoidLine | None = None


class OrderListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: str
    subtotal_amount: Decimal
    total_amount: Decimal
    created_at: datetime


class OrderListResponse(BaseModel):
    items: list[OrderListItem]
    total: int
    limit: int
    offset: int


class RefundItemCreate(BaseModel):
    order_item_id: UUID
    quantity: int = Field(gt=0)


class RefundCreate(BaseModel):
    items: list[RefundItemCreate] = Field(min_length=1, max_length=MAX_REFUND_ITEMS)
    reason: str = Field(pattern="^(customer_return|defective|wrong_item|other)$")
    # Required: a refund always names the tender it is paid back through so the
    # amount can be validated against what was actually collected in that method
    # (a transfer-only order can't be refunded from the cash drawer). Refunds are
    # online-only (never queued offline), so tightening this can't drop a synced
    # refund.
    refund_payment_method: Literal["cash", "bank_transfer", "manual_card"]


class RefundItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_item_id: UUID
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal


class RefundResponse(BaseModel):
    id: UUID
    order_id: UUID
    reason: str
    refunded_amount: Decimal
    items: list[RefundItemResponse]
    created_at: datetime


class VoidCreate(BaseModel):
    not_delivered: bool | None = None
    reason: str = Field(pattern="^(operator_error|wrong_product|system_issue|other)$")


class VoidResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    reason: str
    created_at: datetime

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OrderItemCreate(BaseModel):
    product_id: UUID
    quantity: int = Field(gt=0)


class PaymentCreate(BaseModel):
    method: str = Field(pattern="^(cash|bank_transfer|manual_card)$")
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    amount_tendered: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    reference: str | None = Field(default=None, max_length=255)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(min_length=1)
    payments: list[PaymentCreate] = Field(min_length=1)


class OrderItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price_amount: Decimal
    line_total_amount: Decimal


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    method: str
    amount_amount: Decimal
    amount_tendered_amount: Decimal | None
    change_due_amount: Decimal
    reference: str | None


class OrderResponse(BaseModel):
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
    order_id: UUID
    receipt_number: str
    tenant_name: str
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
    items: list[RefundItemCreate] = Field(min_length=1)
    reason: str = Field(pattern="^(customer_return|defective|wrong_item|other)$")


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
    reason: str = Field(pattern="^(operator_error|wrong_product|system_issue|other)$")


class VoidResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    reason: str
    created_at: datetime

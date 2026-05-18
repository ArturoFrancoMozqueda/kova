from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class SalesSummaryResponse(BaseModel):
    start_date: date
    end_date: date
    gross_sales: Decimal
    refund_total: Decimal
    net_sales: Decimal
    order_count: int
    refund_count: int
    void_count: int


class PaymentBreakdownRow(BaseModel):
    method: str
    amount: Decimal
    payment_count: int


class PaymentBreakdownResponse(BaseModel):
    start_date: date
    end_date: date
    payments: list[PaymentBreakdownRow]


class TopProductRow(BaseModel):
    product_id: UUID
    product_name: str
    quantity_sold: int
    gross_sales: Decimal


class TopProductsResponse(BaseModel):
    start_date: date
    end_date: date
    products: list[TopProductRow]


class SalesByHourRow(BaseModel):
    hour: int
    net_sales: Decimal
    order_count: int


class SalesByEmployeeRow(BaseModel):
    user_id: UUID | None
    display_name: str
    order_count: int
    net_sales: Decimal
    refund_count: int


class RefundsByReasonRow(BaseModel):
    reason: str
    refund_count: int
    refunded_amount: Decimal

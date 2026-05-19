from datetime import date
from decimal import Decimal
from typing import Literal
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


class BusinessStorySummary(BaseModel):
    start_date: date
    end_date: date
    timezone: str
    net_sales: Decimal
    gross_sales: Decimal
    refund_total: Decimal
    completed_orders: int
    average_ticket: Decimal
    refund_count: int
    cancellation_count: int


class BusinessStoryDayRow(BaseModel):
    date: date
    net_sales: Decimal
    order_count: int
    average_ticket: Decimal
    sales_share_pct: int


class BusinessStoryDaypartRow(BaseModel):
    key: Literal["madrugada", "manana", "tarde", "noche"]
    label: str
    start_hour: int
    end_hour: int
    net_sales: Decimal
    order_count: int
    average_ticket: Decimal
    sales_share_pct: int


class BusinessStoryPeakHour(BaseModel):
    hour: int
    label: str
    daypart_key: Literal["madrugada", "manana", "tarde", "noche"]
    net_sales: Decimal
    order_count: int
    sales_share_pct: int


class BusinessStoryProductDriver(BaseModel):
    product_id: UUID
    product_name: str
    quantity_sold: int
    gross_sales: Decimal
    sales_share_pct: int


class BusinessStoryPaymentDriver(BaseModel):
    method: str
    amount: Decimal
    payment_count: int
    sales_share_pct: int


class BusinessStorySignal(BaseModel):
    type: Literal["good_signal", "risk", "operational_improvement"]
    title: str
    detail: str


class BusinessStoryAction(BaseModel):
    type: Literal["opportunity", "risk", "good_signal", "operational_improvement"]
    title: str
    detail: str


class BusinessStoryReportResponse(BaseModel):
    summary: BusinessStorySummary
    executive_summary: str
    sales_by_day: list[BusinessStoryDayRow]
    sales_by_daypart: list[BusinessStoryDaypartRow]
    peak_hour: BusinessStoryPeakHour | None
    top_product_by_sales: BusinessStoryProductDriver | None
    top_product_by_units: BusinessStoryProductDriver | None
    product_drivers: list[BusinessStoryProductDriver]
    dominant_payment: BusinessStoryPaymentDriver | None
    payment_mix: list[BusinessStoryPaymentDriver]
    operational_signals: list[BusinessStorySignal]
    recommended_actions: list[BusinessStoryAction]
    sales_by_employee: list[SalesByEmployeeRow]
    refunds_by_reason: list[RefundsByReasonRow]

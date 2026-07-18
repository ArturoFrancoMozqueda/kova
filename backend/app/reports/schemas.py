from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class ProductTrendRow(BaseModel):
    product_id: UUID
    product_name: str
    current_units: int
    previous_units: int
    delta_units: int
    delta_pct: int
    current_gross: Decimal
    previous_gross: Decimal
    trend: Literal["growing", "declining", "stable", "new", "lost"]


class ProductTrends(BaseModel):
    growing: list[ProductTrendRow]
    declining: list[ProductTrendRow]
    slow_movers: list[ProductTrendRow]


class RestockAlertRow(BaseModel):
    product_id: UUID
    product_name: str
    stock_on_hand: int
    low_stock_threshold: int
    units_per_day_7d: Decimal
    days_until_out: Decimal | None
    severity: Literal["critical", "warning"]
    detail: str


class EmployeeContributionRow(BaseModel):
    user_id: UUID | None
    display_name: str
    order_count: int
    net_sales: Decimal
    refund_count: int
    sales_share_pct: int


class EmployeeContribution(BaseModel):
    top: EmployeeContributionRow | None
    rows: list[EmployeeContributionRow]
    even_distribution: bool


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
    refunded_amount: Decimal = Decimal("0.00")
    net_amount: Decimal = Decimal("0.00")
    payment_count: int


class PaymentBreakdownResponse(BaseModel):
    start_date: date
    end_date: date
    payments: list[PaymentBreakdownRow]
    gross_total: Decimal = Decimal("0.00")
    refund_total: Decimal = Decimal("0.00")
    net_total: Decimal = Decimal("0.00")


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


class MarginSummary(BaseModel):
    net_sales: Decimal
    cogs: Decimal | None
    gross_profit: Decimal | None
    gross_margin_pct: Decimal | None
    sold_products: int
    sold_products_without_cost: int
    complete: bool


class MarginDayRow(BaseModel):
    date: date
    net_sales: Decimal
    cogs: Decimal | None
    gross_profit: Decimal | None
    gross_margin_pct: Decimal | None
    products_without_cost: int
    complete: bool


class MarginProductRow(BaseModel):
    product_id: UUID
    product_name: str
    quantity_sold: int
    net_sales: Decimal
    cogs: Decimal | None
    gross_profit: Decimal | None
    gross_margin_pct: Decimal | None
    missing_cost: bool


class MarginReport(BaseModel):
    summary: MarginSummary
    by_day: list[MarginDayRow]
    by_product: list[MarginProductRow]


class InventoryValuation(BaseModel):
    value: Decimal | None
    known_value: Decimal
    tracked_products: int
    products_without_cost: int
    units_without_cost: int
    complete: bool


class WasteByReasonRow(BaseModel):
    reason_code: Literal["merma", "caducidad", "robo", "daño", "autoconsumo", "otro"]
    units: int
    value: Decimal | None
    products_without_cost: int


class WasteReport(BaseModel):
    units: int
    movement_count: int
    value: Decimal | None
    known_value: Decimal
    products_without_cost: int
    complete: bool
    by_reason: list[WasteByReasonRow]


class OperatingExpenseCategoryRow(BaseModel):
    category: Literal[
        "renta",
        "nomina",
        "servicios",
        "transporte",
        "mantenimiento",
        "marketing",
        "comisiones",
        "impuestos",
        "otro",
    ]
    amount: Decimal
    expense_count: int


class OperatingExpenseReport(BaseModel):
    total: Decimal
    expense_count: int
    approximate_operating_profit: Decimal | None
    margin_complete: bool
    by_category: list[OperatingExpenseCategoryRow]


class BusinessStoryPaymentDriver(BaseModel):
    method: str
    amount: Decimal
    refunded_amount: Decimal = Decimal("0.00")
    net_amount: Decimal = Decimal("0.00")
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
    margin: MarginReport
    inventory_valuation: InventoryValuation
    waste: WasteReport
    operating_expenses: OperatingExpenseReport
    product_trends: ProductTrends
    restock_alerts: list[RestockAlertRow]
    dominant_payment: BusinessStoryPaymentDriver | None
    payment_mix: list[BusinessStoryPaymentDriver]
    operational_signals: list[BusinessStorySignal]
    recommended_actions: list[BusinessStoryAction]
    sales_by_employee: list[SalesByEmployeeRow]
    employee_contribution: EmployeeContribution
    refunds_by_reason: list[RefundsByReasonRow]

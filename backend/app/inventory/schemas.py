from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.shared.validation import StrictModel


class InventoryStockItem(BaseModel):
    product_id: UUID
    product_name: str
    sku: str | None
    track_inventory: bool
    stock_on_hand: int
    low_stock_threshold: int | None
    is_low_stock: bool


class InventoryMovementResponse(BaseModel):
    id: UUID | None
    product_id: UUID
    movement_type: str
    quantity_delta: int
    stock_on_hand: int
    reason: str


class InventoryAdjustmentCreate(StrictModel):
    quantity_delta: int
    reason: str = Field(min_length=1, max_length=255)

    @field_validator("quantity_delta")
    @classmethod
    def quantity_delta_must_not_be_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Quantity delta must not be zero")
        return value


class StockTakeCreate(StrictModel):
    counted_quantity: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=255)


class LowStockThresholdUpdate(StrictModel):
    low_stock_threshold: int | None = Field(default=None, ge=0)


class MovementHistoryItem(BaseModel):
    id: UUID
    movement_type: str
    quantity_delta: int
    stock_on_hand_after: int | None
    reason: str | None
    created_by_user_id: UUID | None
    created_at: datetime


class MovementHistoryResponse(BaseModel):
    items: list[MovementHistoryItem]
    total: int
    limit: int
    offset: int


class InventoryVelocityItem(BaseModel):
    product_id: UUID
    product_name: str
    units_per_day_7d: Decimal
    days_until_out: Decimal | None
    stock_on_hand: int

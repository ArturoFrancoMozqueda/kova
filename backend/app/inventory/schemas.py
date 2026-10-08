from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.inventory.lot_schemas import LotAllocation, LotCount, LotHistoryAllocation
from app.shared.validation import INTEGER_MAX, INTEGER_MIN, StrictModel

InventoryReasonCode = Literal["merma", "caducidad", "robo", "daño", "autoconsumo", "otro"]


class InventoryStockItem(BaseModel):
    product_id: UUID
    product_name: str
    sku: str | None
    track_inventory: bool
    track_lots: bool = False
    stock_on_hand: int
    reserved_quantity: int
    available_quantity: int
    low_stock_threshold: int | None
    is_low_stock: bool


class InventoryMovementResponse(BaseModel):
    id: UUID | None
    product_id: UUID
    movement_type: str
    quantity_delta: int
    stock_on_hand: int
    reason: str
    reason_code: InventoryReasonCode | None = None


class InventoryAdjustmentCreate(StrictModel):
    lot_allocations: list[LotAllocation] | None = Field(default=None, max_length=100)
    quantity_delta: int = Field(ge=INTEGER_MIN, le=INTEGER_MAX)
    reason: str = Field(min_length=1, max_length=255)
    reason_code: InventoryReasonCode | None = None

    @field_validator("quantity_delta")
    @classmethod
    def quantity_delta_must_not_be_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Quantity delta must not be zero")
        return value


class StockTakeCreate(StrictModel):
    lot_counts: list[LotCount] | None = Field(default=None, max_length=1000)
    counted_quantity: int = Field(ge=0, le=INTEGER_MAX)
    reason: str = Field(min_length=1, max_length=255)


class LowStockThresholdUpdate(StrictModel):
    low_stock_threshold: int | None = Field(default=None, ge=0, le=INTEGER_MAX)


class MovementHistoryItem(BaseModel):
    lot_allocations: list[LotHistoryAllocation] = Field(default_factory=list)
    id: UUID
    movement_type: str
    quantity_delta: int
    stock_on_hand_after: int | None
    reason: str | None
    reason_code: InventoryReasonCode | None = None
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

from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    pass


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    sort_order: int | None = None
    is_active: bool | None = None


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    description: str | None
    sort_order: int
    is_active: bool


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    sku: str | None = Field(default=None, max_length=100)
    price_amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    category_id: UUID | None = None
    track_inventory: bool = False
    low_stock_threshold: int | None = Field(default=None, ge=0)


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    sku: str | None = Field(default=None, max_length=100)
    price_amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    category_id: UUID | None = None
    track_inventory: bool | None = None
    low_stock_threshold: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    category_id: UUID | None
    name: str
    description: str | None
    sku: str | None
    price_amount: Decimal
    track_inventory: bool
    low_stock_threshold: int | None
    is_active: bool
    modifier_groups: list = Field(default_factory=list)

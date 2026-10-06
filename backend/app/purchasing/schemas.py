from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.shared.validation import INTEGER_MAX, StrictModel, reject_html


class SupplierCreate(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    contact: str | None = Field(default=None, max_length=200)

    @field_validator("name", "contact")
    @classmethod
    def clean(cls, value):
        value = value.strip() if value is not None else None
        reject_html(value)
        if value == "":
            raise ValueError("El campo no puede quedar vacío")
        return value


class SupplierResponse(SupplierCreate):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    is_active: bool


class PurchaseItemCreate(StrictModel):
    product_id: UUID
    quantity: int = Field(gt=0, le=INTEGER_MAX)
    unit_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class PurchaseCreate(StrictModel):
    supplier_id: UUID
    notes: str | None = Field(default=None, max_length=500)
    items: list[PurchaseItemCreate] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def unique_products(self):
        if len({item.product_id for item in self.items}) != len(self.items):
            raise ValueError("No repitas productos en la compra")
        return self


class ReceiveItem(StrictModel):
    item_id: UUID
    quantity: int = Field(gt=0, le=INTEGER_MAX)


class PurchaseReceive(StrictModel):
    items: list[ReceiveItem] = Field(min_length=1, max_length=200)
    update_catalog_cost: bool = False

    @model_validator(mode="after")
    def unique_items(self):
        if len({item.item_id for item in self.items}) != len(self.items):
            raise ValueError("No repitas partidas en la recepción")
        return self


class PurchaseItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    received_quantity: int
    unit_cost: Decimal


class PurchaseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    branch_id: UUID
    supplier_id: UUID
    supplier_name: str
    status: Literal["pending", "partial", "received", "cancelled"]
    notes: str | None
    created_at: datetime
    items: list[PurchaseItemResponse]

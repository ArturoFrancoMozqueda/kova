from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.shared.validation import StrictModel, non_nullable_patch_schema, reject_html, reject_null


class CategoryCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    sort_order: int = 0

    @field_validator("name")
    @classmethod
    def _name_no_html(cls, value: str) -> str:
        return reject_html(value) or value


class CategoryUpdate(StrictModel):
    name: str | None = Field(
        default=None, min_length=1, max_length=120, json_schema_extra=non_nullable_patch_schema
    )
    description: str | None = Field(default=None, max_length=500)
    sort_order: int | None = Field(default=None, json_schema_extra=non_nullable_patch_schema)
    is_active: bool | None = Field(default=None, json_schema_extra=non_nullable_patch_schema)

    _required_fields = field_validator("name", "sort_order", "is_active", mode="before")(
        reject_null
    )

    @field_validator("name")
    @classmethod
    def _name_no_html(cls, value: str | None) -> str | None:
        return reject_html(value)


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    description: str | None
    sort_order: int
    is_active: bool


class ProductCreate(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    sku: str | None = Field(default=None, max_length=100)
    price_amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    cost_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    category_id: UUID | None = None
    track_inventory: bool = False
    low_stock_threshold: int | None = Field(default=None, ge=0)
    image_position_x: int = Field(default=50, ge=0, le=100)
    image_position_y: int = Field(default=50, ge=0, le=100)
    image_zoom: float = Field(default=1.0, ge=0.5, le=3.0)

    @field_validator("name")
    @classmethod
    def _name_no_html(cls, value: str) -> str:
        return reject_html(value) or value


class ProductUpdate(StrictModel):
    name: str | None = Field(
        default=None, min_length=1, max_length=160, json_schema_extra=non_nullable_patch_schema
    )
    description: str | None = Field(default=None, max_length=1000)
    sku: str | None = Field(default=None, max_length=100)
    price_amount: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=12,
        decimal_places=2,
        json_schema_extra=non_nullable_patch_schema,
    )
    cost_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    category_id: UUID | None = None
    track_inventory: bool | None = Field(default=None, json_schema_extra=non_nullable_patch_schema)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    image_position_x: int | None = Field(
        default=None, ge=0, le=100, json_schema_extra=non_nullable_patch_schema
    )
    image_position_y: int | None = Field(
        default=None, ge=0, le=100, json_schema_extra=non_nullable_patch_schema
    )
    image_zoom: float | None = Field(
        default=None, ge=0.5, le=3.0, json_schema_extra=non_nullable_patch_schema
    )
    is_active: bool | None = Field(default=None, json_schema_extra=non_nullable_patch_schema)

    _required_fields = field_validator(
        "name",
        "price_amount",
        "track_inventory",
        "image_position_x",
        "image_position_y",
        "image_zoom",
        "is_active",
        mode="before",
    )(reject_null)

    @field_validator("name")
    @classmethod
    def _name_no_html(cls, value: str | None) -> str | None:
        return reject_html(value)


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    category_id: UUID | None
    name: str
    description: str | None
    sku: str | None
    price_amount: Decimal
    cost_price: Decimal | None
    track_inventory: bool
    low_stock_threshold: int | None
    image_url: str | None = None
    image_position_x: int = 50
    image_position_y: int = 50
    image_zoom: float = 1.0
    is_active: bool
    modifier_groups: list = Field(default_factory=list)

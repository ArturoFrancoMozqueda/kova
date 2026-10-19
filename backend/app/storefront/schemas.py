from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.shared.validation import StrictModel, reject_html


class CatalogWrite(StrictModel):
    expected_version: int = Field(ge=0)
    enabled: bool
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=500)
    whatsapp_phone: str | None = Field(default=None, pattern=r"^[1-9][0-9]{9,14}$")
    product_ids: list[UUID] = Field(default_factory=list, max_length=200)
    rotate_link: bool = False

    @field_validator("title", "description")
    @classmethod
    def clean_text(cls, value):
        if value is not None:
            value = value.strip()
            reject_html(value)
            if not value:
                raise ValueError("El texto no puede estar vacío")
        return value

    @field_validator("product_ids")
    @classmethod
    def unique_products(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("No repitas productos")
        return value


class CatalogSettings(BaseModel):
    enabled: bool
    title: str
    description: str | None
    whatsapp_phone: str | None
    product_ids: list[UUID]
    version: int
    share_path: str | None


class PublicProduct(BaseModel):
    id: UUID
    name: str
    description: str | None
    price_amount: Decimal
    availability: str


class PublicCatalogResponse(BaseModel):
    title: str
    description: str | None
    whatsapp_phone: str | None
    products: list[PublicProduct]
    checkout_available: bool = False

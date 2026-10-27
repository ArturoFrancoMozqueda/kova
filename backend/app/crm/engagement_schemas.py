from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.crm.schemas import _OpportunityFields
from app.customer_orders.schemas import CustomerOrderResponse
from app.shared.validation import StrictModel, reject_html


class PublicOrderLine(StrictModel):
    product_id: UUID
    quantity: int = Field(ge=1, le=99, strict=True)


class CatalogOrderLine(PublicOrderLine):
    product_name: str
    unit_price_amount: Decimal
    line_total_amount: Decimal


class PublicRequestWrite(StrictModel):
    submission_id: UUID
    name: str = Field(min_length=1, max_length=160)
    contact: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=1000)
    product_ids: list[UUID] = Field(default_factory=list, max_length=20)
    order_lines: list[PublicOrderLine] | None = Field(default=None, min_length=1, max_length=20)
    origin: Literal["remote", "in_store"] | None = None

    @model_validator(mode="after")
    def structured_order(self):
        if self.order_lines is None:
            if self.origin is not None:
                raise ValueError("El origen requiere productos y cantidades estructurados")
            return self
        ids = [line.product_id for line in self.order_lines]
        if len(set(ids)) != len(ids) or set(ids) != set(self.product_ids):
            raise ValueError("Los productos del pedido deben coincidir sin repetirse")
        if self.origin is None:
            raise ValueError("Indica si el pedido es a distancia o en el negocio")
        return self

    @field_validator("name", "contact", "message")
    @classmethod
    def text(cls, value):
        value = value.strip()
        reject_html(value)
        if not value:
            raise ValueError("El texto no puede estar vacío")
        return value

    @field_validator("product_ids")
    @classmethod
    def unique(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("No repitas productos")
        return value


class PublicRequestReceipt(BaseModel):
    receipt_id: UUID
    status: Literal["received"] = "received"
    tracking_path: str | None = None
    tracking_expires_at: datetime | None = None


class CatalogRequestResponse(BaseModel):
    id: UUID
    name: str
    contact: str
    message: str
    product_ids: list[UUID]
    status: Literal["new", "converted", "dismissed", "accepted"]
    customer_id: UUID | None
    opportunity_id: UUID | None
    order_lines: list[CatalogOrderLine] | None = None
    origin: Literal["remote", "in_store"] | None = None
    customer_order_id: UUID | None = None
    version: int
    created_at: datetime


class CatalogRequestList(BaseModel):
    requests: list[CatalogRequestResponse]
    has_more: bool


class CatalogOrderPreviewLine(CatalogOrderLine):
    available_quantity: int | None


class CatalogOrderPreview(BaseModel):
    request_id: UUID
    version: int
    items: list[CatalogOrderPreviewLine]
    total_amount: Decimal
    can_accept: bool
    issues: list[str]
    preview_fingerprint: str
    customer_order_id: UUID | None


class CatalogOrderAccept(StrictModel):
    expected_version: int = Field(ge=1)
    customer_id: UUID
    preview_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    confirmed: Literal[True]


class CatalogOrderAcceptance(BaseModel):
    request: CatalogRequestResponse
    customer_order: CustomerOrderResponse


class PublicOrderTrackingRead(StrictModel):
    token: str


class PublicTrackedItem(BaseModel):
    product_name: str
    quantity: int


class PublicOrderTracking(BaseModel):
    business_name: str
    branch_name: str
    status: Literal[
        "pending_review", "accepted", "confirmed", "in_progress", "ready", "fulfilled",
        "cancelled", "dismissed",
    ]
    folio: str | None
    total_amount: Decimal | None
    items: list[PublicTrackedItem]
    catalog_path: str | None
    updated_at: datetime
    expires_at: datetime


class RequestResolve(StrictModel):
    expected_version: int = Field(ge=1)
    status: Literal["converted", "dismissed"]
    customer_id: UUID | None = None

    @model_validator(mode="after")
    def customer_required(self):
        if (self.status == "converted") != (self.customer_id is not None):
            raise ValueError("Elige un cliente sólo para convertir la solicitud")
        return self


class PolicyWrite(StrictModel):
    expected_version: int = Field(ge=0)
    enabled: bool
    review_delay_days: int = Field(ge=1, le=30)
    rebuy_delay_days: int = Field(ge=2, le=365)


class PolicyResponse(BaseModel):
    enabled: bool
    review_delay_days: int
    rebuy_delay_days: int
    version: int


class IncidentWrite(_OpportunityFields):
    customer_id: UUID
    sale_order_id: UUID | None = None
    title: str = Field(min_length=1, max_length=160)
    note: str | None = Field(default=None, max_length=1000)
    due_at: datetime
    assigned_user_id: UUID | None = None


class FollowupUpdate(_OpportunityFields):
    expected_version: int = Field(ge=1)
    status: Literal["completed", "dismissed"] | None = None
    note: str | None = Field(default=None, max_length=1000)
    due_at: datetime | None = None
    assigned_user_id: UUID | None = None

    @field_validator("status", "due_at", mode="before")
    @classmethod
    def not_null(cls, value):
        if value is None:
            raise ValueError("Este campo no puede ser null")
        return value


class FollowupResponse(BaseModel):
    id: UUID
    customer_id: UUID
    customer_name: str
    sale_order_id: UUID | None
    kind: Literal["review", "rebuy", "incident"]
    status: Literal["pending", "completed", "dismissed"]
    title: str
    note: str | None
    due_at: datetime
    assigned_user_id: UUID | None
    version: int


class FollowupOverview(BaseModel):
    policy: PolicyResponse
    tasks: list[FollowupResponse]
    has_more: bool


class FollowupProcessResponse(BaseModel):
    created: int

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from app.integrations.schemas import InvoiceRecipient

Environment = Literal["test", "live"]
TaxKind = Literal["iva16", "iva8", "iva0", "exempt", "not_subject"]


class ConnectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    environment: Environment
    api_key: SecretStr = Field(min_length=10, max_length=1000)


class EnvironmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    environment: Environment


class ConnectionPublic(BaseModel):
    environment: Environment
    organization_id: str
    connected: bool
    issuer_rfc: str | None
    production_ready: bool
    certificate_expires_at: datetime | None


class StatusResponse(BaseModel):
    provider: Literal["facturapi"] = "facturapi"
    storage_available: bool
    connections: list[ConnectionPublic]


class InvoiceLinePreparation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    order_item_id: UUID
    product_key: str = Field(pattern=r"^[0-9]{8}$")
    unit_key: str = Field(pattern=r"^[A-Z0-9]{2,3}$")
    tax_kind: TaxKind
    tax_included: bool


class InvoicePreparation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    environment: Environment
    recipient: InvoiceRecipient | None = None
    payment_form: Literal["01", "03", "04", "28"]
    lines: list[InvoiceLinePreparation] = Field(min_length=1, max_length=200)


class CancellationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    motive: Literal["01", "02", "03"]
    substitution_uuid: UUID | None = None

    @model_validator(mode="after")
    def substitution(self):
        if (self.motive == "01") != (self.substitution_uuid is not None):
            raise ValueError("El motivo 01 requiere UUID sustituto; otros motivos no lo admiten")
        return self


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    request_id: UUID
    order_id: UUID
    environment: Environment
    state: Literal[
        "prepared",
        "submitting",
        "unknown",
        "pending",
        "issued",
        "cancel_pending",
        "canceled",
        "rejected",
        "integrity_error",
    ]
    provider_id: str | None
    uuid: UUID | None
    total_amount: Decimal
    created_at: datetime
    updated_at: datetime
    last_error_code: str | None
    cancellation_status: str | None
    xml_available: bool
    recipient_snapshot: dict


class ContextLine(BaseModel):
    order_item_id: UUID
    product_name: str
    quantity: int
    unit_price_amount: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    line_total_amount: Decimal


class ContextResponse(BaseModel):
    request_id: UUID
    order_id: UUID
    issuer: dict
    recipient: dict
    total_amount: Decimal
    discount_amount: Decimal
    lines: list[ContextLine]
    payments: list[dict[str, str]]
    suggested_payment_forms: list[str]


class PreviewLine(BaseModel):
    order_item_id: UUID
    product_name: str
    quantity: int
    product_key: str
    unit_key: str
    tax_kind: TaxKind
    tax_included: bool
    unit_price_amount: Decimal
    gross_amount: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal


class PreviewResponse(BaseModel):
    recipient_snapshot: dict
    request_id: UUID
    order_id: UUID
    environment: Environment
    subtotal_amount: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    lines: list[PreviewLine]

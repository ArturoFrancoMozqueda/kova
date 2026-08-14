from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import EmailStr, Field

from app.shared.validation import StrictModel


class BusinessProfileUpsert(StrictModel):
    public_name: str = Field(min_length=1, max_length=255)
    support_email: EmailStr | None = None
    support_phone: str | None = Field(default=None, max_length=50)
    timezone: str = Field(default="America/Mexico_City", min_length=1, max_length=80)
    locale: str = Field(default="es-MX", min_length=2, max_length=20)
    currency: str = Field(default="MXN", min_length=3, max_length=3)


class BusinessProfileResponse(BusinessProfileUpsert):
    tenant_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReceiptSettingsUpsert(StrictModel):
    receipt_business_name: str = Field(min_length=1, max_length=255)
    footer: str | None = Field(default=None, max_length=1000)
    tax_contact_text: str | None = Field(default=None, max_length=1000)
    logo_url: str | None = Field(default=None, max_length=1000)
    # Optional on writes so an older installed PWA cannot reset a tenant's
    # 58 mm preference merely because its PUT payload predates this field.
    paper_width_mm: Literal[58, 80] | None = None


class ReceiptSettingsResponse(ReceiptSettingsUpsert):
    paper_width_mm: Literal[58, 80] = 80
    tenant_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

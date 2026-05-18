from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class BusinessProfileUpsert(BaseModel):
    public_name: str = Field(min_length=1, max_length=255)
    support_email: EmailStr | None = None
    support_phone: str | None = Field(default=None, max_length=50)
    timezone: str = Field(default="America/Mexico_City", min_length=1, max_length=80)
    locale: str = Field(default="es-MX", min_length=2, max_length=20)
    currency: str = Field(default="MXN", min_length=3, max_length=3)


class BusinessProfileResponse(BusinessProfileUpsert):
    tenant_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReceiptSettingsUpsert(BaseModel):
    receipt_business_name: str = Field(min_length=1, max_length=255)
    footer: str | None = Field(default=None, max_length=1000)
    tax_contact_text: str | None = Field(default=None, max_length=1000)
    logo_url: str | None = Field(default=None, max_length=1000)


class ReceiptSettingsResponse(ReceiptSettingsUpsert):
    tenant_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

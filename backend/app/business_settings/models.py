from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class BusinessProfile(Base):
    __tablename__ = "tenant_business_profiles"

    tenant_id: Mapped[UUID] = mapped_column(primary_key=True)
    public_name: Mapped[str] = mapped_column(String(255), nullable=False)
    support_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    support_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    timezone: Mapped[str] = mapped_column(String(80), nullable=False, default="America/Mexico_City")
    locale: Mapped[str] = mapped_column(String(20), nullable=False, default="es-MX")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="MXN")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class ReceiptSettings(Base):
    __tablename__ = "tenant_receipt_settings"

    tenant_id: Mapped[UUID] = mapped_column(primary_key=True)
    receipt_business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    footer: Mapped[str | None] = mapped_column(Text, nullable=True)
    tax_contact_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

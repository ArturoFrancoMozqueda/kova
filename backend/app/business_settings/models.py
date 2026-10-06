from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
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
    default_tax_rate: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=0, server_default="0"
    )
    paper_width_mm: Mapped[int] = mapped_column(Integer, nullable=False, default=80)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    __table_args__ = (
        CheckConstraint(
            "default_tax_rate >= 0 AND default_tax_rate <= 100", name="ck_receipt_settings_tax_rate"
        ),
        CheckConstraint("paper_width_mm IN (58, 80)", name="ck_receipt_settings_paper_width"),
    )


class TenantLogoFile(Base):
    __tablename__ = "tenant_logo_files"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    bytes_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    __table_args__ = (UniqueConstraint("tenant_id", name="uq_tenant_logo_files_tenant_id"),)

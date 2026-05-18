from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class TenantOnboardingState(Base):
    __tablename__ = "tenant_onboarding_state"

    tenant_id: Mapped[UUID] = mapped_column(primary_key=True)
    business_profile_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    receipt_settings_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_product_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    inventory_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    shift_opened_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    first_sale_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    billing_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

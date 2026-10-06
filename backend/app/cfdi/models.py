from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.db import Base

ACTIVE_STATES = (
    "prepared",
    "submitting",
    "unknown",
    "pending",
    "issued",
    "cancel_pending",
    "integrity_error",
)


def now():
    return datetime.now(UTC)


class CfdiConnection(Base):
    __tablename__ = "cfdi_connections"
    __table_args__ = (
        ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        UniqueConstraint("tenant_id", "environment", name="uq_cfdi_connection_environment"),
        UniqueConstraint("tenant_id", "id", name="uq_cfdi_connection_tenant_id"),
        CheckConstraint("environment IN ('test','live')", name="ck_cfdi_connection_environment"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    environment: Mapped[str] = mapped_column(String(8), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False)
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    issuer_rfc: Mapped[str | None] = mapped_column(String(13), nullable=True)
    production_ready: Mapped[bool] = mapped_column(nullable=False, default=False)
    certificate_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CfdiDocument(BranchScoped, Base):
    __tablename__ = "cfdi_documents"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
            name="fk_cfdi_document_order",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "request_id"],
            ["invoice_requests.tenant_id", "invoice_requests.id"],
            name="fk_cfdi_document_request",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "connection_id"],
            ["cfdi_connections.tenant_id", "cfdi_connections.id"],
            name="fk_cfdi_document_connection",
        ),
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_cfdi_document_idempotency"),
        UniqueConstraint("external_id", name="uq_cfdi_document_external"),
        UniqueConstraint("provider_key", name="uq_cfdi_document_provider_key"),
        CheckConstraint("environment IN ('test','live')", name="ck_cfdi_document_environment"),
        CheckConstraint(
            "state IN ('prepared','submitting','unknown','pending','issued',"
            "'cancel_pending','canceled','rejected','integrity_error')",
            name="ck_cfdi_document_state",
        ),
        CheckConstraint("total_amount > 0", name="ck_cfdi_document_total"),
        Index(
            "uq_cfdi_document_active_sale",
            "tenant_id",
            "order_id",
            "environment",
            unique=True,
            postgresql_where=text("state NOT IN ('canceled','rejected')"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    order_id: Mapped[UUID] = mapped_column(nullable=False)
    request_id: Mapped[UUID] = mapped_column(nullable=False)
    connection_id: Mapped[UUID] = mapped_column(nullable=False)
    environment: Mapped[str] = mapped_column(String(8), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(100), nullable=False)
    state: Mapped[str] = mapped_column(String(24), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_key: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_id: Mapped[str | None] = mapped_column(String(100))
    uuid: Mapped[UUID | None] = mapped_column(nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    xml_bytes: Mapped[bytes | None] = mapped_column(LargeBinary)
    last_error_code: Mapped[str | None] = mapped_column(String(80))
    cancellation_status: Mapped[str | None] = mapped_column(String(40))
    cancellation_key: Mapped[str | None] = mapped_column(String(200))
    cancellation_hash: Mapped[str | None] = mapped_column(String(64))
    cancellation_payload: Mapped[dict | None] = mapped_column(JSON)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[UUID] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    @property
    def xml_available(self):
        return self.xml_bytes is not None

    @property
    def recipient_snapshot(self):
        customer = self.payload["customer"]
        return {
            "rfc": customer["tax_id"],
            "legal_name": customer["legal_name"],
            "tax_regime": customer["tax_system"],
            "postal_code": customer["address"]["zip"],
            "email": customer["email"],
            "cfdi_use": self.payload["use"],
        }

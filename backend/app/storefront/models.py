from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.branches.scope import BranchScoped
from app.orm_metadata import Base


class PublicCatalog(BranchScoped, Base):
    __tablename__ = "public_catalogs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "branch_id", name="uq_public_catalog_branch"),
        UniqueConstraint("tenant_id", "id", name="uq_public_catalog_tenant_id"),
        ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500))
    whatsapp_phone: Mapped[str | None] = mapped_column(String(15))
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    link_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


class PublicCatalogItem(Base):
    __tablename__ = "public_catalog_items"
    __table_args__ = (
        UniqueConstraint("catalog_id", "product_id", name="uq_public_catalog_item_product"),
        ForeignKeyConstraint(
            ["tenant_id", "catalog_id"], ["public_catalogs.tenant_id", "public_catalogs.id"]
        ),
        ForeignKeyConstraint(["tenant_id", "product_id"], ["products.tenant_id", "products.id"]),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    catalog_id: Mapped[UUID] = mapped_column(nullable=False)
    product_id: Mapped[UUID] = mapped_column(nullable=False)

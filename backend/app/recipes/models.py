"""Recipes consumed at sale and per-option ingredient adjustments.

A recipe version is immutable: editing creates a new version effective from
that moment, so an offline sale rung earlier still consumes the version that
was current at the counter and historical costs never change.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.orm_metadata import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Recipe(Base):
    __tablename__ = "recipes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "product_id"],
            ["products.tenant_id", "products.id"],
            name="fk_recipes_tenant_product",
        ),
        UniqueConstraint("tenant_id", "id", name="uq_recipes_tenant_id_id"),
        UniqueConstraint("tenant_id", "product_id", "version", name="uq_recipes_product_version"),
        CheckConstraint("version > 0", name="ck_recipes_version"),
        CheckConstraint("mode IN ('on_sale', 'batch')", name="ck_recipes_mode"),
        Index("ix_recipes_product_effective", "tenant_id", "product_id", "effective_from"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    product_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # on_sale: consumed when the product is sold. batch is reserved for production.
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="on_sale")
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RecipeLine(Base):
    __tablename__ = "recipe_lines"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "recipe_id"],
            ["recipes.tenant_id", "recipes.id"],
            name="fk_recipe_lines_tenant_recipe",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "ingredient_product_id"],
            ["products.tenant_id", "products.id"],
            name="fk_recipe_lines_tenant_ingredient",
        ),
        UniqueConstraint("recipe_id", "ingredient_product_id", name="uq_recipe_lines_ingredient"),
        CheckConstraint("quantity > 0", name="ck_recipe_lines_quantity"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    recipe_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    ingredient_product_id: Mapped[UUID] = mapped_column(nullable=False)
    # Whole units of the ingredient's stock unit (ml, g or pieces).
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)


class ModifierOptionConsumption(Base):
    __tablename__ = "modifier_option_consumptions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "modifier_option_id"],
            ["modifier_options.tenant_id", "modifier_options.id"],
            name="fk_option_consumptions_tenant_option",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "ingredient_product_id"],
            ["products.tenant_id", "products.id"],
            name="fk_option_consumptions_tenant_ingredient",
        ),
        UniqueConstraint(
            "modifier_option_id", "ingredient_product_id", name="uq_option_consumptions_ingredient"
        ),
        CheckConstraint("quantity <> 0", name="ck_option_consumptions_quantity"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    modifier_option_id: Mapped[UUID] = mapped_column(nullable=False, index=True)
    ingredient_product_id: Mapped[UUID] = mapped_column(nullable=False)
    # Signed: "leche de almendra" = -240 ml leche entera, +240 ml leche de almendra.
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog.models import Category, Product

_PRESETS_DIR = Path(__file__).resolve().parent.parent.parent / "presets"


def _load_preset(preset_name: str) -> dict[str, Any]:
    path = _PRESETS_DIR / f"{preset_name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _has_products(db: Session, *, tenant_id: UUID) -> bool:
    return (
        db.query(Product)
        .filter(Product.tenant_id == tenant_id, Product.is_active.is_(True))
        .limit(1)
        .count()
        > 0
    )


def apply_preset(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    preset_name: str,
) -> dict[str, Any]:
    if _has_products(db, tenant_id=tenant_id):
        return {
            "preset": preset_name,
            "categories_created": 0,
            "products_created": 0,
            "skipped": True,
        }

    data = _load_preset(preset_name)
    now = datetime.now(UTC)

    category_map: dict[str, UUID] = {}
    for cat_data in data["categories"]:
        cat = Category(
            id=uuid4(),
            tenant_id=tenant_id,
            name=cat_data["name"],
            description=cat_data.get("description"),
            sort_order=cat_data.get("sort_order", 0),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(cat)
        db.flush()
        category_map[cat_data["name"]] = cat.id

    products_created = 0
    for prod_data in data["products"]:
        product = Product(
            id=uuid4(),
            tenant_id=tenant_id,
            category_id=category_map.get(prod_data.get("category", "")),
            name=prod_data["name"],
            description=prod_data.get("description"),
            sku=prod_data.get("sku"),
            price_amount=Decimal(prod_data["price_amount"]),
            track_inventory=prod_data.get("track_inventory", False),
            low_stock_threshold=prod_data.get("low_stock_threshold"),
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        db.add(product)
        products_created += 1

    db.flush()
    audit_service.log(
        db,
        action="onboarding.preset.applied",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="tenant",
        resource_id=tenant_id,
        changes={
            "preset": preset_name,
            "categories_created": len(data["categories"]),
            "products_created": products_created,
        },
    )
    db.commit()

    return {
        "preset": preset_name,
        "categories_created": len(data["categories"]),
        "products_created": products_created,
        "skipped": False,
    }

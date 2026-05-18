import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.billing.access import get_billing_access_status
from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.catalog.models import Category, Product
from app.onboarding.models import TenantOnboardingState
from app.orders.models import Order
from app.shifts.models import Shift

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


def get_onboarding_state(db: Session, *, tenant_id: UUID) -> dict[str, Any]:
    state = db.get(TenantOnboardingState, tenant_id)
    if state is None:
        state = TenantOnboardingState(tenant_id=tenant_id)
        db.add(state)

    business_profile_completed = (
        db.query(BusinessProfile).filter(BusinessProfile.tenant_id == tenant_id).first()
        is not None
    )
    receipt_settings_completed = (
        db.query(ReceiptSettings).filter(ReceiptSettings.tenant_id == tenant_id).first()
        is not None
    )
    first_product_completed = (
        db.query(Product)
        .filter(Product.tenant_id == tenant_id, Product.is_active.is_(True))
        .limit(1)
        .count()
        > 0
    )
    inventory_completed = (
        db.query(Product)
        .filter(
            Product.tenant_id == tenant_id,
            Product.is_active.is_(True),
            Product.track_inventory.is_(True),
        )
        .limit(1)
        .count()
        > 0
    )
    shift_opened_completed = (
        db.query(Shift).filter(Shift.tenant_id == tenant_id).limit(1).count() > 0
    )
    first_sale_completed = (
        db.query(Order).filter(Order.tenant_id == tenant_id).limit(1).count() > 0
    )
    billing_access = get_billing_access_status(db, tenant_id=tenant_id)
    billing_completed = billing_access.reason in {"active_subscription", "subscription_trial"}

    updates = {
        "business_profile_completed": business_profile_completed,
        "receipt_settings_completed": receipt_settings_completed,
        "first_product_completed": first_product_completed,
        "inventory_completed": inventory_completed,
        "shift_opened_completed": shift_opened_completed,
        "first_sale_completed": first_sale_completed,
        "billing_completed": billing_completed,
    }
    for key, value in updates.items():
        setattr(state, key, value)
    state.updated_at = datetime.now(UTC)
    db.commit()

    steps = [
        ("business_profile", "Business profile", business_profile_completed, "/settings/business-profile"),
        ("receipt_settings", "Receipt settings", receipt_settings_completed, "/settings/receipt"),
        ("first_product", "Create product", first_product_completed, "/catalog?new=product"),
        ("inventory", "Activate inventory", inventory_completed, "/inventory"),
        ("open_shift", "Open shift", shift_opened_completed, "/shifts"),
        ("first_sale", "First sale", first_sale_completed, "/register"),
        ("billing", "Billing", billing_completed, "/settings/billing"),
    ]
    return {
        "tenant_id": str(tenant_id),
        "completed_count": sum(1 for _, _, completed, _ in steps if completed),
        "total_count": len(steps),
        "steps": [
            {"key": key, "label": label, "completed": completed, "action_path": action_path}
            for key, label, completed, action_path in steps
        ],
    }

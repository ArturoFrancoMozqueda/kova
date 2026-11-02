"""Server-owned plan catalog, separate from RBAC, rollout flags and payment access."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import Session

from app.billing import repository
from app.config import settings
from app.tenants.models import Tenant

CORE_FEATURES = ("pos", "inventory", "sales_reports", "public_catalog")
GESTION_FEATURES = CORE_FEATURES + (
    "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes",
)


@dataclass(frozen=True)
class CommercialPlan:
    code: str
    name: str
    amount_minor_units: int
    tax_inclusive: bool | None
    features: tuple[str, ...]
    product_image_bytes: int | None
    branches: int | None = None

    def public(self) -> dict:
        return {
            "code": self.code, "name": self.name,
            "amount_minor_units": self.amount_minor_units,
            "currency": "MXN", "interval": "month", "tax_inclusive": self.tax_inclusive,
            "features": list(self.features),
            "limits": {"product_image_bytes": self.product_image_bytes, "branches": self.branches},
        }


PLANS = {
    "standard": CommercialPlan("standard", "Standard Plan", 29_900, None, GESTION_FEATURES, None),
    "esencial": CommercialPlan("esencial", "Esencial", 39_900, True, CORE_FEATURES, 250_000_000, 1),
    "gestion": CommercialPlan(
        "gestion", "Gestión", 69_900, True, GESTION_FEATURES, 1_073_741_824, 1,
    ),
}


def tiered_pricing_enabled() -> bool:
    """No new enrollment or advertised checkout until all server inputs exist."""
    new_ids = (settings.stripe_esencial_price_id, settings.stripe_gestion_price_id)
    return bool(
        settings.billing_tiered_plans_enabled
        and all(new_ids)
        and len(set(new_ids)) == 2
        and settings.stripe_standard_price_id not in new_ids
        and settings.stripe_secret_key
        and settings.stripe_checkout_success_url
        and settings.stripe_checkout_cancel_url
    )


def is_tiered_tenant(db: Session, tenant_id: UUID) -> bool:
    tenant = db.get(Tenant, tenant_id)
    return tenant is not None and tenant.billing_cohort == "tiered"


def build_plan_snapshot(db: Session, *, tenant_id: UUID) -> dict:
    subscription = repository.get_subscription_by_tenant(db, tenant_id=tenant_id)
    if (subscription and subscription.complimentary_access is True
            and not subscription.stripe_subscription_id):
        code = "standard"
    elif not is_tiered_tenant(db, tenant_id):
        code = "standard"
    elif subscription is None or not subscription.stripe_subscription_id:
        # A trial's expiry is enforced independently by get_billing_access_status.
        code = "gestion"
    elif subscription.status == "trialing" and subscription.plan_code in {"esencial", "gestion"}:
        code = "gestion"
    else:
        code = (
            subscription.plan_code
            if subscription.plan_code in {"esencial", "gestion"} else "unknown"
        )
    if code == "unknown":
        return {"plan_code": "unknown", "plan_name": "Verificación pendiente",
                "features": [], "limits": {"product_image_bytes": None, "branches": None}}
    plan = PLANS[code]
    return {"plan_code": code, "plan_name": plan.name, "features": list(plan.features),
            "limits": {"product_image_bytes": plan.product_image_bytes, "branches": plan.branches}}


def plan_has_feature(db: Session, *, tenant_id: UUID, feature: str) -> bool:
    return feature in build_plan_snapshot(db, tenant_id=tenant_id)["features"]


def available_plans(db: Session, *, tenant_id: UUID) -> list[dict]:
    if not is_tiered_tenant(db, tenant_id):
        return [PLANS["standard"].public()]
    if not tiered_pricing_enabled():
        return []
    return [PLANS["esencial"].public(), PLANS["gestion"].public()]


def configured_price_id(code: str) -> str | None:
    return {
        "standard": settings.stripe_standard_price_id,
        "esencial": settings.stripe_esencial_price_id,
        "gestion": settings.stripe_gestion_price_id,
    }.get(code)


def plan_for_price(price: dict) -> CommercialPlan | None:
    """Identity is the configured Price ID, never the price amount or client metadata."""
    price_id = price.get("id")
    candidates = [p for p in PLANS.values() if price_id and configured_price_id(p.code) == price_id]
    if len(candidates) != 1:
        return None
    plan = candidates[0]
    recurring = price.get("recurring") or {}
    if (price.get("unit_amount") != plan.amount_minor_units
            or str(price.get("currency") or "").upper() != "MXN"
            or recurring.get("interval") != "month"
            or recurring.get("interval_count", 1) != 1
            or (plan.tax_inclusive and price.get("tax_behavior") != "inclusive")):
        return None
    return plan

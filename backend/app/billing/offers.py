"""Public offer identity: deterministic catalog data, with no provider I/O or secrets."""

import hashlib
import json
from typing import Any

from app.billing.plans import PLANS


def public_offer(*, tiered: bool) -> dict[str, Any]:
    """The same snapshot labels the public prices and the signup cohort.

    This revision detects stale forms; it is public data, not a credential or
    evidence of payment. Provider IDs and keys do not identify the displayed offer.
    """
    codes = ("esencial", "gestion") if tiered else ("standard",)
    plans = [PLANS[code].public() for code in codes]
    identity = {"cohort": "tiered" if tiered else "standard", "available_plans": plans}
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    revision = "offer-v1-" + hashlib.sha256(canonical.encode()).hexdigest()
    return {
        "offer_revision": revision,
        "tiered_pricing_enabled": tiered,
        "available_plans": plans,
    }

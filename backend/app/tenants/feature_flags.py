from collections.abc import Mapping

MARGIN_REPORTS = "margin_reports"
CUSTOMER_ORDERS = "customer_orders"
FISCAL_GLOBAL_DRAFTS = "fiscal_global_drafts"

DEFAULT_FEATURE_FLAGS: dict[str, bool] = {
    MARGIN_REPORTS: False,
    CUSTOMER_ORDERS: True,
    FISCAL_GLOBAL_DRAFTS: True,
}


def is_feature_killed(flag: str) -> bool:
    """Return server-controlled emergency state for supported kill switches."""
    if flag != FISCAL_GLOBAL_DRAFTS:
        return False

    # Import lazily so every resolution observes current runtime configuration.
    from app.config import settings

    return settings.fiscal_global_drafts_kill_switch


def resolve_feature_flags(overrides: object) -> dict[str, bool]:
    """Return only supported boolean overrides on top of safe defaults."""
    resolved = DEFAULT_FEATURE_FLAGS.copy()
    if isinstance(overrides, Mapping):
        for flag in resolved:
            value = overrides.get(flag)
            if type(value) is bool:
                resolved[flag] = value

    for flag in resolved:
        if is_feature_killed(flag):
            resolved[flag] = False
    return resolved

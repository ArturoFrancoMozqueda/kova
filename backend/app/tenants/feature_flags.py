from collections.abc import Mapping

MARGIN_REPORTS = "margin_reports"

DEFAULT_FEATURE_FLAGS: dict[str, bool] = {
    MARGIN_REPORTS: False,
}


def resolve_feature_flags(overrides: object) -> dict[str, bool]:
    """Return only supported boolean overrides on top of safe defaults."""
    resolved = DEFAULT_FEATURE_FLAGS.copy()
    if not isinstance(overrides, Mapping):
        return resolved

    for flag in resolved:
        value = overrides.get(flag)
        if type(value) is bool:
            resolved[flag] = value
    return resolved

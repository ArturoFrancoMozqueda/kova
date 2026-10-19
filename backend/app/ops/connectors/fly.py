"""Historical response key retained after the provider's permanent retirement.

Old configuration must never reactivate requests or billable resources.
"""
from app.ops.connectors.base import ConnectorResult, not_configured


def fetch_status(*, timeout: float) -> ConnectorResult:
    return not_configured()

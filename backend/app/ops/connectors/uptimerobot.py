"""UptimeRobot connector — monitor states and uptime ratios for the tech panel."""
from app.config import settings
from app.ops import deep_links
from app.ops.connectors.base import (
    ConnectorError,
    ConnectorResult,
    degraded,
    http_post_form,
    not_configured,
)

_URL = "https://api.uptimerobot.com/v2/getMonitors"

# UptimeRobot monitor status codes.
_UP = 2
_SEEMS_DOWN = 8
_DOWN = 9
_PAUSED = 0


def fetch_monitors(*, timeout: float) -> ConnectorResult:
    if not settings.uptimerobot_api_key:
        return not_configured()
    data = {
        "api_key": settings.uptimerobot_api_key,
        "format": "json",
        "custom_uptime_ratios": "1-7-30",
    }
    try:
        raw = http_post_form(
            _URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=timeout,
        )
    except ConnectorError as exc:
        return degraded(str(exc))
    if not isinstance(raw, dict) or raw.get("stat") != "ok":
        return degraded("UptimeRobot API error")
    monitors = []
    status = "ok"
    for item in raw.get("monitors", []):
        mon_status = item.get("status")
        ratios = (item.get("custom_uptime_ratio") or "").split("-")
        monitors.append(
            {
                "name": item.get("friendly_name"),
                "monitor_status": mon_status,
                "uptime_1d": _ratio(ratios, 0),
                "uptime_7d": _ratio(ratios, 1),
                "uptime_30d": _ratio(ratios, 2),
                "deep_link": deep_links.uptimerobot_dashboard(),
            }
        )
        if mon_status in (_SEEMS_DOWN, _DOWN):
            status = "critical"
        elif mon_status == _PAUSED and status != "critical":
            status = "warning"
    return ConnectorResult(status=status, data={"monitors": monitors})


def _ratio(ratios: list[str], index: int) -> float | None:
    if index < len(ratios):
        try:
            return float(ratios[index])
        except ValueError:
            return None
    return None

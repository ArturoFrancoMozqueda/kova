"""Tenant-timezone helpers shared by reports and order listing.

Sale time is stored in UTC but must be bucketed into the tenant's local
calendar day (a sale at 23:50 America/Mexico_City belongs to that local day,
even though it is already the next day in UTC). Both the reports module and the
order-list day filters need the same tenant timezone and local-day bounds, so
the logic lives here to stay consistent.
"""

from datetime import UTC, date, datetime, time
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.business_settings.models import BusinessProfile

DEFAULT_TIMEZONE = "America/Mexico_City"


def tenant_timezone(db: Session, *, tenant_id: UUID) -> ZoneInfo:
    profile = db.get(BusinessProfile, tenant_id)
    timezone_name = profile.timezone if profile else DEFAULT_TIMEZONE
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TIMEZONE)


def local_day_bounds(
    start_date: date, end_date: date, tz: ZoneInfo
) -> tuple[datetime, datetime]:
    """Inclusive [start-of-day, end-of-day] in the tenant tz, returned as UTC."""
    local_start = datetime.combine(start_date, time.min, tzinfo=tz)
    local_end = datetime.combine(end_date, time.max, tzinfo=tz)
    return local_start.astimezone(UTC), local_end.astimezone(UTC)

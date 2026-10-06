"""Minimal event pointer written in the SAME transaction as operational effects."""

from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.assistant.access import cohort
from app.config import settings

WATCHED = {
    "orders",
    "refunds",
    "voids",
    "inventory_movements",
    "shifts",
    "products",
    "categories",
    "tenant_business_profiles",
    "tenant_receipt_settings",
    "branches",
}


@event.listens_for(Session, "before_flush")
def mark_change(db, *_):
    if not settings.assistant_enabled:
        return
    allowed = set(cohort())
    changed = {
        getattr(row, "tenant_id", None)
        for row in (*db.new, *db.dirty)
        if getattr(row, "__tablename__", None) in WATCHED
    }
    for tenant in changed & allowed:
        db.execute(
            text("""INSERT INTO assistant_control.events(tenant_key,happened_at)
            VALUES (:tenant,now()) ON CONFLICT (tenant_key) DO UPDATE SET happened_at=now()"""),
            {"tenant": tenant},
        )

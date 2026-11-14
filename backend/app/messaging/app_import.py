"""Import address-book metadata without merging CRM contacts or granting consent."""

from app.messaging.models import AppContact, AppSync, now


def apply_metadata(db, tenant, binding, event):
    if event.kind == "contact":
        row = (
            db.query(AppContact)
            .filter_by(
                tenant_id=tenant,
                branch_id=binding.branch_id,
                binding_id=binding.id,
                external_party=event.sender,
            )
            .first()
        )
        if row is None:
            row = AppContact(
                tenant_id=tenant,
                branch_id=binding.branch_id,
                binding_id=binding.id,
                external_party=event.sender,
                changed_at=event.timestamp,
            )
            db.add(row)
        elif row.changed_at > event.timestamp or (
            row.changed_at == event.timestamp and row.removed
        ):
            return
        row.name, row.removed, row.changed_at = (
            event.text,
            event.status == "remove",
            event.timestamp,
        )
    else:
        row = (
            db.query(AppSync)
            .filter_by(
                tenant_id=tenant,
                branch_id=binding.branch_id,
                binding_id=binding.id,
            )
            .first()
        )
        if row is None:
            return
        if event.kind == "disconnect":
            row.history_state = "review_required"
        if event.progress is not None:
            row.progress = max(row.progress, event.progress)
        if event.status in {"completed", "declined", "review_required"}:
            # A known error cannot be cleared by a later generic progress event.
            if row.history_state != "review_required":
                row.history_state = event.status
        row.updated_at = now()

"""One-shot Meta synchronization and durable, tenant-scoped import recovery."""

import json
from dataclasses import asdict
from datetime import UTC, datetime, timedelta

from app.branches.scope import active_branch_id
from app.messaging import credentials
from app.messaging.credentials import InvalidToken
from app.messaging.models import AppSync, ChannelBinding, WebhookBatch
from app.messaging.webhooks import ChannelEvent, VerifiedEnvelope
from app.messaging.whatsapp import ChannelError


def sync_row(db, tenant, branch, binding=None):
    query = db.query(AppSync).filter_by(tenant_id=tenant, branch_id=branch)
    return query.filter_by(binding_id=binding).first() if binding else query.first()


def ready(db, tenant, branch, binding):
    row = sync_row(db, tenant, branch, binding)
    return row is None or (
        row.contacts_state == "requested"
        and row.history_state in {"completed", "declined"}
        and not db.query(WebhookBatch.id)
        .filter_by(
            tenant_id=tenant,
            branch_id=branch,
            binding_id=binding,
        )
        .filter(WebhookBatch.state != "completed")
        .first()
    )


def projection(db, tenant, branch):
    row = sync_row(db, tenant, branch)
    if row is None:
        return {"coexistence": False, "sync_status": "not_required", "sync_progress": 0}
    review = (
        "review_required" in {row.contacts_state, row.history_state}
        or "requesting" in {row.contacts_state, row.history_state}
        and row.updated_at < datetime.now(UTC) - timedelta(minutes=2)
        or row.started_at < datetime.now(UTC) - timedelta(hours=24)
        and row.history_state not in {"completed", "declined"}
        or db.query(WebhookBatch.id)
        .filter_by(tenant_id=tenant, branch_id=branch, state="review_required")
        .first()
        is not None
    )
    return {
        "coexistence": True,
        "sync_status": "review_required"
        if review
        else "ready"
        if ready(db, tenant, branch, row.binding_id)
        else "synchronizing",
        "sync_progress": row.progress,
    }


def request_once(db, row, provider, token, phone):
    """Journal before each POST. Neither timeouts nor page refresh repeat an import."""
    for kind in ("contacts", "history"):
        if kind == "history" and row.contacts_state != "requested":
            return
        field = f"{kind}_state"
        if getattr(row, field) != "pending":
            continue
        if row.started_at < datetime.now(UTC) - timedelta(hours=24):
            setattr(row, field, "review_required")
            db.commit()
            return
        setattr(row, field, "requesting")
        row.updated_at = datetime.now(UTC)
        db.commit()
        try:
            request_id = provider.sync_app_data(token, phone, kind)
        except ChannelError:
            db.refresh(row)
            setattr(row, field, "review_required")
            db.commit()
            return
        db.refresh(row)  # A signed completion webhook can beat the POST response.
        setattr(row, f"{kind}_request_id", request_id)
        if getattr(row, field) == "requesting":
            setattr(row, field, "requested")
        row.updated_at = datetime.now(UTC)
        db.commit()


def capture(db, tenant, binding, envelope, raw_hash):
    from app.messaging import service

    service._lock(db, tenant)
    branch = active_branch_id(db, tenant)
    if not sync_row(db, tenant, branch, binding.id):
        raise ChannelError("trusted_channel_binding_required")
    if (
        db.query(WebhookBatch.id)
        .filter_by(
            tenant_id=tenant,
            branch_id=branch,
            binding_id=binding.id,
            payload_hash=raw_hash,
        )
        .first()
    ):
        return
    # Store only this binding's verified events, never a multi-tenant raw request.
    payload = {
        "purpose": "whatsapp-app-batch-v1",
        "tenant": str(tenant),
        "branch": str(branch),
        "binding": str(binding.id),
        "events": [asdict(e) for e in envelope.events],
    }
    encrypted = credentials._cipher().encrypt(json.dumps(payload, default=str).encode()).decode()
    db.add(
        WebhookBatch(
            tenant_id=tenant,
            branch_id=branch,
            binding_id=binding.id,
            payload_hash=raw_hash,
            encrypted_payload=encrypted,
        )
    )
    db.flush()


def process_pending(db, tenant, *, limit=100):
    """A bounded transaction under ordinary RLS; caller commits cursor + messages."""
    from app.messaging import service

    service._lock(db, tenant)
    branch = active_branch_id(db, tenant)
    batch = (
        db.query(WebhookBatch)
        .filter_by(
            tenant_id=tenant,
            branch_id=branch,
            state="pending",
        )
        .order_by(WebhookBatch.created_at, WebhookBatch.id)
        .with_for_update(skip_locked=True)
        .first()
    )
    if batch is None:
        return 0
    binding = (
        db.query(ChannelBinding)
        .filter_by(
            id=batch.binding_id,
            tenant_id=tenant,
            branch_id=branch,
            enabled=True,
        )
        .first()
    )
    if binding is None:
        batch.state, batch.encrypted_payload = "review_required", None
        return 0
    try:
        payload = json.loads(credentials._cipher().decrypt(batch.encrypted_payload.encode()))
        if (
            payload.get("purpose") != "whatsapp-app-batch-v1"
            or payload.get("tenant") != str(tenant)
            or payload.get("branch") != str(branch)
            or payload.get("binding") != str(binding.id)
        ):
            raise ValueError
        data = payload["events"]
        events = []
        for item in data[batch.cursor : batch.cursor + min(max(limit, 1), 1000)]:
            item["timestamp"] = datetime.fromisoformat(item["timestamp"])
            events.append(ChannelEvent(**item))
    except (InvalidToken, ValueError, KeyError, TypeError, AttributeError):
        batch.state = "review_required"
        return 0
    try:
        with db.begin_nested():
            service.ingest_envelope(
                db,
                tenant_id=tenant,
                binding=binding,
                envelope=VerifiedEnvelope(
                    waba_id=binding.waba_id,
                    phone_number_id=binding.phone_number_id,
                    events=tuple(events),
                ),
            )
    except ChannelError:
        batch.state = "review_required"
        db.flush()
        return 0
    batch.cursor += len(events)
    if batch.cursor >= len(data):
        batch.state, batch.encrypted_payload = "completed", None
    db.flush()
    return len(events)

"""Explicit human delivery and signed ingress through ordinary tenant RLS sessions."""

from starlette.concurrency import run_in_threadpool

from app.branches.scope import bind_branch
from app.config import settings
from app.db import SessionLocal, set_tenant_context
from app.messaging import connections, service
from app.messaging.schemas import InboxMessageTransition
from app.messaging.webhooks import parse_verified_webhook, verify_signature
from app.messaging.whatsapp import ChannelError
from app.shared.exceptions import conflict


def send_human_reply(db, tenant, actor, message_id, body, key):
    try:
        connection = connections.resolve_connection(db, tenant)
        if connection is None or not connection.send_enabled:
            raise conflict("Los envíos de WhatsApp no están habilitados en esta sucursal")
        # Resolve credentials before queue authorization; no global/shared token.
        provider = connections.provider_for(connection)
    except ChannelError:
        raise conflict("Revisa la conexión de WhatsApp antes de enviar") from None
    service.transition_message(
        db,
        tenant,
        actor,
        message_id,
        InboxMessageTransition(expected_version=body.expected_version, action="queue"),
        key,
        human_reply=True,
    )
    service.dispatch_one(
        db,
        tenant_id=tenant,
        message_id=message_id,
        provider=provider,
        enabled=True,
        human_actor=actor,
        daily_send_limit=connection.daily_send_limit,
    )
    # Replays consult the durable state, never repeat an accepted/uncertain send.
    return service._message_response(service._message(db, tenant, message_id))


def _ingest(raw_body, signature):
    registry = connections.configured_connections()
    # Validate the entire matched batch before any branch is committed. The
    # registry, never account IDs from the envelope, establishes the RLS scope.
    pending = []
    for connection in registry:
        envelope = parse_verified_webhook(
            raw_body=raw_body,
            signature=signature,
            app_secret=settings.whatsapp_app_secret,
            expected_waba_id=connection.waba_id,
            expected_phone_number_id=connection.phone_number_id,
            allow_other_accounts=True,
        )
        if envelope.events:
            pending.append(connection)
    for connection in pending:
        with SessionLocal() as db:
            set_tenant_context(db, connection.tenant_id)
            bind_branch(db, tenant_id=connection.tenant_id, branch_id=connection.branch_id)
            trusted = connections.resolve_connection(db, connection.tenant_id)
            if trusted is None or trusted.binding_id != connection.binding_id:
                raise ChannelError("trusted_channel_binding_required")
            service.ingest_webhook(
                db,
                tenant_id=connection.tenant_id,
                binding_id=connection.binding_id,
                raw_body=raw_body,
                signature=signature,
                app_secret=settings.whatsapp_app_secret,
                allow_other_accounts=True,
            )
            db.commit()
    # Unknown accounts are acknowledged without revealing configured customers.
    # Retries after a partial DB failure are safe through the existing event ledger.


async def receive(raw_body, signature):
    verify_signature(
        raw_body=raw_body,
        signature=signature,
        app_secret=settings.whatsapp_app_secret,
    )
    await run_in_threadpool(_ingest, raw_body, signature)

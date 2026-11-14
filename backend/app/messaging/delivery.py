"""Explicit human delivery and signed ingress through ordinary tenant RLS sessions."""

import hashlib
import logging
from dataclasses import replace
from types import SimpleNamespace

from sqlalchemy import or_, tuple_
from starlette.concurrency import run_in_threadpool

from app.branches.scope import bind_branch
from app.config import settings
from app.db import PrivilegedSessionLocal, SessionLocal, set_tenant_context
from app.messaging import app_sync, connections, service
from app.messaging.models import ChannelBinding, ChannelConnection
from app.messaging.schemas import InboxMessageTransition
from app.messaging.webhooks import (
    parse_verified_webhook,
    routing_accounts,
    routing_revocations,
    verify_signature,
)
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
    if settings.whatsapp_signup_enabled:
        accounts = routing_accounts(raw_body)
        revoked = routing_revocations(raw_body)
        if accounts or revoked:
            # Deliberately privileged exact routing lookup, AFTER HMAC. It
            # returns trusted scope only; message writes use kova_app and RLS.
            with PrivilegedSessionLocal() as lookup:
                rows = (
                    lookup.query(ChannelBinding)
                    .join(ChannelConnection, ChannelConnection.binding_id == ChannelBinding.id)
                    .filter(
                        or_(
                            tuple_(ChannelBinding.waba_id, ChannelBinding.phone_number_id).in_(
                                accounts
                            ),
                            ChannelBinding.waba_id.in_(revoked),
                        ),
                        ChannelBinding.enabled.is_(True),
                        ChannelBinding.verified_at.is_not(None),
                    )
                    .all()
                )
                for row in rows:
                    if any(item.phone_number_id == row.phone_number_id for item in registry):
                        raise ChannelError("channel_configuration_invalid")
                    # Routing does not require decrypting any credentials.
                    registry.append(
                        SimpleNamespace(
                            tenant_id=row.tenant_id,
                            branch_id=row.branch_id,
                            binding_id=row.id,
                            waba_id=row.waba_id,
                            phone_number_id=row.phone_number_id,
                        )
                    )
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
    queued = []
    for connection in pending:
        with SessionLocal() as db:
            set_tenant_context(db, connection.tenant_id)
            bind_branch(db, tenant_id=connection.tenant_id, branch_id=connection.branch_id)
            trusted = connections.resolve_connection(db, connection.tenant_id)
            if trusted is None or trusted.binding_id != connection.binding_id:
                raise ChannelError("trusted_channel_binding_required")
            envelope = parse_verified_webhook(
                raw_body=raw_body,
                signature=signature,
                app_secret=settings.whatsapp_app_secret,
                expected_waba_id=connection.waba_id,
                expected_phone_number_id=connection.phone_number_id,
                allow_other_accounts=True,
            )
            binding = (
                db.query(ChannelBinding)
                .filter_by(
                    id=connection.binding_id,
                    tenant_id=connection.tenant_id,
                    branch_id=connection.branch_id,
                )
                .one()
            )
            if not app_sync.sync_row(db, connection.tenant_id, connection.branch_id, binding.id):
                # Coexistence fields never turn a standard or assisted binding into
                # an app connection. Still accept its ordinary messages/receipts.
                envelope = replace(
                    envelope,
                    events=tuple(e for e in envelope.events if e.kind in {"inbound", "receipt"}),
                )
            if any(e.kind not in {"inbound", "receipt"} for e in envelope.events):
                app_sync.capture(
                    db,
                    connection.tenant_id,
                    binding,
                    envelope,
                    hashlib.sha256(raw_body).hexdigest(),
                )
                queued.append((connection.tenant_id, connection.branch_id))
            else:
                service.ingest_envelope(
                    db, tenant_id=connection.tenant_id, binding=binding, envelope=envelope
                )
            db.commit()
    # Unknown accounts are acknowledged without revealing configured customers.
    # Retries after a partial DB failure are safe through the existing event ledger.
    return queued


def process_captured(scopes):
    # Best-effort wakeup after durable capture. Scheduler and authenticated sync
    # polling recover the same cursor if this process is interrupted.
    for tenant, branch in set(scopes):
        try:
            with SessionLocal() as db:
                set_tenant_context(db, tenant)
                bind_branch(db, tenant_id=tenant, branch_id=branch)
                app_sync.process_pending(db, tenant, limit=1000)
                db.commit()
        except Exception:
            logging.getLogger(__name__).error("WhatsApp import iteration failed")


async def receive(raw_body, signature):
    verify_signature(
        raw_body=raw_body,
        signature=signature,
        app_secret=settings.whatsapp_app_secret,
    )
    return await run_in_threadpool(_ingest, raw_body, signature)

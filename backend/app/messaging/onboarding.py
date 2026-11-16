"""Authenticated, journaled onboarding. Only this verified path may create a binding.

The ordinary runtime role keeps SELECT-only binding/credential access. Caller
identity and branch are resolved with that role before using the explicit
privileged session; no tenant/actor/branch field is accepted from the browser.
"""

import hashlib
import hmac
import secrets
import sys
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.exc import IntegrityError

from app.audit import service as audit
from app.auth.models import Membership, User
from app.branches.models import Branch
from app.branches.scope import active_branch_id, bind_branch, tenant_wide_branches
from app.config import settings
from app.db import set_tenant_context
from app.messaging import app_sync, connections, credentials
from app.messaging.models import AppSync, ChannelBinding, ChannelConnection, SignupSession
from app.messaging.provisioning import provision_binding
from app.messaging.signup_provider import SignupProvider
from app.messaging.whatsapp import ChannelError
from app.shared.exceptions import conflict, forbidden, not_found
from app.tenants.models import Tenant

IN_PROGRESS = {"exchanging", "subscribing", "registering"}


def platform_available():
    return bool(
        sys.platform != "emscripten"
        and settings.whatsapp_signup_enabled
        and settings.whatsapp_app_id
        and settings.whatsapp_signup_config_id
        and connections.platform_ready()
        and credentials.available()
    )


def available(db, tenant):
    if not platform_available():
        return False
    business = db.get(Tenant, tenant)
    flags = business.feature_overrides if business is not None else None
    return isinstance(flags, dict) and flags.get("whatsapp_signup_pilot") is True


def status(db, tenant, *, owner):
    branch = active_branch_id(db, tenant)
    row = (
        db.query(SignupSession)
        .filter_by(tenant_id=tenant, branch_id=branch)
        .order_by(SignupSession.created_at.desc())
        .first()
    )
    state = row.state if row else "not_started"
    if state in IN_PROGRESS | {"authorized", "subscribed"}:
        state = (
            "processing"
            if row.updated_at > datetime.now(UTC) - timedelta(minutes=2)
            else "review_required"
        )
    if state == "pending" and row.expires_at <= datetime.now(UTC):
        state = "failed"
    enabled = available(db, tenant)
    return {
        "available": enabled,
        "can_manage": owner,
        "app_id": settings.whatsapp_app_id if enabled and owner else None,
        "config_id": settings.whatsapp_signup_config_id if enabled and owner else None,
        "graph_version": settings.whatsapp_graph_api_version if enabled and owner else None,
        "state": state,
        **app_sync.projection(db, tenant, branch),
    }


def _scope(db, tenant, branch, actor):
    set_tenant_context(db, tenant)
    bind_branch(db, tenant_id=tenant, branch_id=branch)
    # Serialize all platform changes for this branch, including ownership checks.
    if db.query(Branch).filter_by(tenant_id=tenant, id=branch).with_for_update().first() is None:
        raise forbidden()
    member = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant,
            Membership.user_id == actor,
            Membership.role == "owner",
            Membership.is_active.is_(True),
            User.is_active.is_(True),
        )
        .first()
    )
    if member is None or member.allowed_branch_id not in (None, branch):
        raise forbidden("El dueño del negocio debe autorizar esta conexión")


def start(db, tenant, branch, actor):
    if not available(db, tenant):
        raise conflict("La conexión con Meta aún requiere preparación de Kova")
    _scope(db, tenant, branch, actor)
    rows = (
        db.query(SignupSession)
        .filter_by(tenant_id=tenant, branch_id=branch)
        .filter(
            SignupSession.state.in_(
                IN_PROGRESS | {"pending", "authorized", "subscribed", "review_required"}
            )
        )
        .all()
    )
    for row in rows:
        if row.state in IN_PROGRESS | {"authorized", "subscribed", "review_required"}:
            raise conflict("La conexión anterior requiere revisión; consulta a soporte")
        if row.state == "pending":
            row.state = "failed"
    nonce = secrets.token_urlsafe(32)
    row = SignupSession(
        id=uuid4(),
        tenant_id=tenant,
        branch_id=branch,
        actor_id=actor,
        nonce_hash=hashlib.sha256(nonce.encode()).hexdigest(),
        state="pending",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    db.add(row)
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action="messaging.signup.started",
        resource_type="messaging",
        resource_id=row.id,
        changes={"branch_id": str(branch)},
    )
    db.commit()
    return {"session_id": row.id, "nonce": nonce, "expires_at": row.expires_at}


def _session(db, tenant, branch, actor, body):
    _scope(db, tenant, branch, actor)
    row = (
        db.query(SignupSession)
        .filter_by(id=body.session_id, tenant_id=tenant, branch_id=branch, actor_id=actor)
        .with_for_update()
        .first()
    )
    if row is None:
        raise not_found("Conexión no encontrada")
    digest = hashlib.sha256(body.nonce.get_secret_value().encode()).hexdigest()
    if not hmac.compare_digest(digest, row.nonce_hash):
        raise forbidden("Vuelve a iniciar la conexión con Meta")
    return row


def _step(db, row, state):
    row.state, row.updated_at = state, datetime.now(UTC)
    db.commit()  # Persist BEFORE external I/O; interruptions must never replay a code/register.


def _ownership(db, tenant, branch, waba, phone):
    # Phone ownership is global. No operation ever moves a phone between tenants.
    with tenant_wide_branches(db):
        number = db.query(ChannelBinding).filter_by(phone_number_id=phone).first()
    existing = db.query(ChannelBinding).filter_by(tenant_id=tenant, branch_id=branch).first()
    if number and (
        number.tenant_id != tenant or number.branch_id != branch or number.waba_id != waba
    ):
        raise ChannelError("account_already_bound")
    if existing and (existing.phone_number_id != phone or existing.waba_id != waba):
        raise ChannelError("branch_already_bound")
    # A number in the assisted registry must never acquire a second owner/source.
    if any(c.phone_number_id == phone for c in connections.configured_connections()):
        raise ChannelError("assisted_connection_requires_review")
    return existing


def finish(db, tenant, branch, actor, body, *, provider=None):
    if not available(db, tenant):
        raise conflict("La conexión con Meta aún requiere preparación de Kova")
    row = _session(db, tenant, branch, actor, body)
    code_hash = hashlib.sha256(body.code.get_secret_value().encode()).hexdigest()
    if row.state == "connected" and row.code_hash == code_hash:
        return connections.connection_status(db, tenant)
    if row.state != "pending" or row.expires_at <= datetime.now(UTC):
        raise conflict("Actualiza el estado de la conexión antes de continuar")
    if (
        db.query(SignupSession)
        .filter(SignupSession.code_hash == code_hash, SignupSession.id != row.id)
        .first()
    ):
        raise conflict("Esta autorización ya se utilizó; vuelve a conectar con Meta")
    provider = provider or SignupProvider()
    row.code_hash = code_hash
    row.waba_id, row.phone_number_id = body.waba_id, body.phone_number_id
    coexistence = body.event == "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
    phone = body.phone_number_id
    try:
        existing = _ownership(db, tenant, branch, body.waba_id, phone) if phone else None
        pin = None if coexistence else f"{secrets.randbelow(1_000_000):06d}"
        if existing:
            saved = (
                db.query(ChannelConnection)
                .filter_by(binding_id=existing.id, tenant_id=tenant, branch_id=branch)
                .first()
            )
            if saved is None:
                raise ChannelError("assisted_connection_requires_review")
            _previous_token, pin = credentials.decrypt(
                tenant=tenant,
                branch=branch,
                waba=body.waba_id,
                phone=body.phone_number_id,
                encrypted=saved.encrypted_credentials,
            )
        _step(db, row, "exchanging")
        token = provider.exchange(body.code)
        if coexistence:
            phone, expiry = provider.verify_business_app(token, body.waba_id, phone)
            row.phone_number_id = phone
        else:
            expiry = provider.verify(token, body.waba_id, phone)
        existing = _ownership(db, tenant, branch, body.waba_id, phone)
        if existing and bool(app_sync.sync_row(db, tenant, branch, existing.id)) != coexistence:
            raise ChannelError("meta_connection_mode_mismatch")
        row.encrypted_credentials = credentials.encrypt(
            tenant=tenant,
            branch=branch,
            waba=body.waba_id,
            phone=phone,
            token=token,
            pin=pin,
        )
        row.token_expires_at = expiry
        _step(db, row, "authorized")
        # The partial unique index serializes verified claims across tenants.
        # A competing claim may have completed while this one waited to commit;
        # prove ownership again BEFORE any external write, not only afterward.
        _scope(db, tenant, branch, actor)
        _ownership(db, tenant, branch, body.waba_id, phone)
        _step(db, row, "subscribing")
        provider.subscribe(token, body.waba_id)
        _step(db, row, "subscribed")
        if existing is None and not coexistence:
            _step(db, row, "registering")
            provider.register(token, phone, pin)
        # Revalidate owner/branch and exclusivity after I/O, before activation.
        _scope(db, tenant, branch, actor)
        existing = _ownership(db, tenant, branch, body.waba_id, phone)
        connection = connections.PilotConnection(
            tenant_id=tenant,
            branch_id=branch,
            binding_id=existing.id if existing else uuid4(),
            waba_id=body.waba_id,
            phone_number_id=phone,
            access_token=token,
        )
        binding = provision_binding(db, connection, authorized_by=actor)
        stored = (
            db.query(ChannelConnection)
            .filter_by(binding_id=binding.id, tenant_id=tenant, branch_id=branch)
            .first()
        )
        if stored is None:
            stored = ChannelConnection(
                binding_id=binding.id,
                tenant_id=tenant,
                branch_id=branch,
                encrypted_credentials=row.encrypted_credentials,
            )
            db.add(stored)
        stored.encrypted_credentials = row.encrypted_credentials
        stored.token_expires_at, stored.updated_at = expiry, datetime.now(UTC)
        sync = app_sync.sync_row(db, tenant, branch, binding.id)
        if coexistence and sync is None:
            sync = AppSync(tenant_id=tenant, branch_id=branch, binding_id=binding.id)
            db.add(sync)
        row.encrypted_credentials = None  # Credentials survive only in their final owner row.
        row.state, row.updated_at = "connected", datetime.now(UTC)
        audit.log(
            db,
            tenant_id=tenant,
            user_id=actor,
            action="messaging.signup.completed",
            resource_type="messaging",
            resource_id=binding.id,
            changes={"operation": "embedded_signup", "branch_id": str(branch)},
        )
        db.commit()
        if coexistence:
            app_sync.request_once(db, sync, provider, token, phone)
        return connections.connection_status(db, tenant)
    except (ChannelError, IntegrityError) as error:
        db.rollback()
        row = _session(db, tenant, branch, actor, body)
        stage = row.state
        row.state = "review_required" if stage in {"subscribing", "registering"} else "failed"
        row.error_code = error.code if isinstance(error, ChannelError) else "ownership_conflict"
        row.updated_at = datetime.now(UTC)
        db.commit()
        raise conflict(
            "No se completó la conexión. Actualiza su estado antes de volver a intentar"
        ) from None


def sending(db, tenant, branch, actor, *, enabled):
    _scope(db, tenant, branch, actor)
    row = (
        db.query(ChannelConnection)
        .filter_by(tenant_id=tenant, branch_id=branch)
        .with_for_update()
        .first()
    )
    if row is None:
        raise conflict("Revisa la conexión de WhatsApp antes de habilitar respuestas")
    if enabled and (
        not connections.platform_ready()
        or connections.stored_connection(db, tenant, branch) is None
    ):
        raise conflict("Revisa la conexión de WhatsApp antes de habilitar respuestas")
    if enabled and not app_sync.ready(db, tenant, branch, row.binding_id):
        raise conflict(
            "Espera a que termine la sincronización de WhatsApp antes de habilitar respuestas"
        )
    row.send_enabled, row.updated_at = enabled, datetime.now(UTC)
    audit.log(
        db,
        tenant_id=tenant,
        user_id=actor,
        action="messaging.sending.updated",
        resource_type="messaging",
        resource_id=row.binding_id,
        changes={"send_enabled": enabled, "branch_id": str(branch)},
    )
    db.commit()
    return connections.connection_status(db, tenant)

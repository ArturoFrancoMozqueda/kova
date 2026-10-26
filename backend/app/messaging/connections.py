"""Server-owned pilot registry. Runtime cannot provision or enable DB bindings.

The secret-store registry is deliberately bounded. Self-service Embedded Signup
is a separate rollout; a phone/account supplied by a browser never establishes scope.
"""

import sys
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, TypeAdapter, ValidationError

from app.branches.scope import active_branch_id
from app.config import settings
from app.messaging.models import ChannelBinding
from app.messaging.whatsapp import ChannelError, WhatsAppCloudAdapter


class PilotConnection(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    tenant_id: UUID
    branch_id: UUID
    binding_id: UUID
    waba_id: str = Field(pattern=r"^[1-9][0-9]{0,31}$")
    phone_number_id: str = Field(pattern=r"^[1-9][0-9]{0,31}$")
    access_token: SecretStr = Field(repr=False)
    send_enabled: bool = False
    daily_send_limit: int = Field(default=25, ge=1, le=1000)


def configured_connections() -> list[PilotConnection]:
    secret = settings.whatsapp_connections
    if secret is None:
        return []
    try:
        raw = secret.get_secret_value()
        if len(raw) > 262144:
            raise ValueError
        rows = TypeAdapter(list[PilotConnection]).validate_json(raw)
        if len(rows) > 50:
            raise ValueError
        for key in ("binding_id", "phone_number_id"):
            if len({getattr(row, key) for row in rows}) != len(rows):
                raise ValueError
        if len({(row.tenant_id, row.branch_id) for row in rows}) != len(rows):
            raise ValueError
        for row in rows:
            token = row.access_token.get_secret_value()
            if (
                not token
                or len(token) > 4096
                or not token.isascii()
                or any(c.isspace() for c in token)
            ):
                raise ValueError
        return rows
    except (ValidationError, ValueError):
        # ValidationError contains input, including secrets: never propagate it.
        raise ChannelError("channel_configuration_invalid") from None


def platform_ready() -> bool:
    return bool(
        settings.kova_whatsapp_enabled
        and settings.whatsapp_graph_api_version
        and settings.whatsapp_app_secret
        and settings.whatsapp_app_secret.get_secret_value()
        and settings.whatsapp_webhook_verify_token
        and settings.whatsapp_webhook_verify_token.get_secret_value()
    )


def resolve_connection(db, tenant_id) -> PilotConnection | None:
    if not platform_ready():
        return None
    branch = active_branch_id(db, tenant_id)
    connection = next(
        (
            row
            for row in configured_connections()
            if row.tenant_id == tenant_id and row.branch_id == branch
        ),
        None,
    )
    if connection is None:
        return None
    binding = (
        db.query(ChannelBinding)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=branch,
            id=connection.binding_id,
            waba_id=connection.waba_id,
            phone_number_id=connection.phone_number_id,
            enabled=True,
        )
        .first()
    )
    return connection if binding is not None and binding.verified_at is not None else None


def connection_status(db, tenant_id):
    try:
        connection = resolve_connection(db, tenant_id)
    except ChannelError:
        return {"status": "configuration_error", "send_enabled": False, "receive_enabled": False}
    if connection is None:
        return {"status": "not_connected", "send_enabled": False, "receive_enabled": False}
    return {
        "status": "connected",
        "send_enabled": connection.send_enabled and sys.platform != "emscripten",
        "receive_enabled": True,
    }


def provider_for(connection: PilotConnection):
    if sys.platform == "emscripten":
        raise ChannelError("native_delivery_required")
    # One request owns its transport. No global client, retries, redirects or URLs
    # from tenants. The existing adapter enforces timeouts and response limits.
    adapter = WhatsAppCloudAdapter(
        access_token=connection.access_token,
        phone_number_id=connection.phone_number_id,
        api_version=settings.whatsapp_graph_api_version,
        transport=httpx.HTTPTransport(retries=0),
    )
    adapter.binding_id = connection.binding_id
    return adapter

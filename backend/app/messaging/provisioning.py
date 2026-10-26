"""Platform-only assisted provisioning, not an HTTP endpoint or runtime grant."""

import json
from datetime import UTC, datetime

import httpx

from app.audit import service as audit
from app.auth.models import Membership, User
from app.branches.models import Branch
from app.branches.scope import bind_branch
from app.config import settings
from app.messaging.models import ChannelBinding
from app.messaging.whatsapp import MAX_RESPONSE_BYTES, ChannelError
from app.tenants.models import Tenant


def verify_account(connection, *, transport):
    if not settings.whatsapp_graph_api_version or transport is None:
        raise ChannelError("channel_configuration_invalid")
    # A platform operator has already established the Kova business identity.
    # Verify the token can see this exact number under the configured WABA.
    try:
        with httpx.Client(
            transport=transport, timeout=10, follow_redirects=False, trust_env=False
        ) as client:
            with client.stream(
                "GET",
                f"https://graph.facebook.com/{settings.whatsapp_graph_api_version}/"
                f"{connection.waba_id}/phone_numbers",
                params={"fields": "id", "limit": "100"},
                headers={"Authorization": f"Bearer {connection.access_token.get_secret_value()}"},
            ) as response:
                if response.status_code != 200:
                    raise ChannelError("account_verification_failed")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    if len(raw) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise ChannelError("account_verification_failed")
                    raw.extend(chunk)
                payload = json.loads(raw)
                if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                    raise ChannelError("account_verification_failed")
                if not any(
                    isinstance(row, dict) and row.get("id") == connection.phone_number_id
                    for row in payload["data"]
                ):
                    raise ChannelError("account_verification_failed")
    except (httpx.RequestError, ValueError, TypeError):
        raise ChannelError("account_verification_failed") from None


def provision_binding(db, connection, *, authorized_by):
    """Requires an operator session; kova_app retains SELECT-only binding access.

    Only run after upstream verification, authorization by the business owner and
    explicit operator selection. Existing phone ownership is never reassigned.
    """
    tenant = db.query(Tenant).filter_by(id=connection.tenant_id, is_active=True).first()
    branch = (
        db.query(Branch)
        .filter_by(
            tenant_id=connection.tenant_id,
            id=connection.branch_id,
        )
        .first()
    )
    if tenant is None or branch is None:
        raise ChannelError("business_scope_invalid")
    member = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == connection.tenant_id,
            Membership.user_id == authorized_by,
            Membership.is_active.is_(True),
            Membership.role.in_(["owner", "manager"]),
            User.is_active.is_(True),
        )
        .first()
    )
    if member is None or (
        member.allowed_branch_id is not None and member.allowed_branch_id != connection.branch_id
    ):
        raise ChannelError("business_authorization_required")
    row = db.query(ChannelBinding).filter_by(phone_number_id=connection.phone_number_id).first()
    by_branch = (
        db.query(ChannelBinding)
        .filter_by(
            tenant_id=connection.tenant_id,
            branch_id=connection.branch_id,
        )
        .first()
    )
    if row is not None and (
        row.id != connection.binding_id
        or row.tenant_id != connection.tenant_id
        or row.branch_id != connection.branch_id
        or row.waba_id != connection.waba_id
    ):
        raise ChannelError("account_already_bound")
    if by_branch is not None and by_branch is not row:
        raise ChannelError("branch_already_bound")
    bind_branch(db, tenant_id=connection.tenant_id, branch_id=connection.branch_id)
    if row is None:
        row = ChannelBinding(
            id=connection.binding_id,
            tenant_id=connection.tenant_id,
            branch_id=connection.branch_id,
            waba_id=connection.waba_id,
            phone_number_id=connection.phone_number_id,
        )
        db.add(row)
    row.verified_at = datetime.now(UTC)
    row.enabled = True
    db.flush()
    audit.log(
        db,
        tenant_id=connection.tenant_id,
        user_id=authorized_by,
        action="messaging.channel.provisioned",
        resource_type="messaging",
        resource_id=row.id,
        changes={"operation": "assisted_provisioning", "branch_id": str(connection.branch_id)},
    )
    return row

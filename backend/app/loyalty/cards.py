"""Expiring, read-only capabilities over the existing branch points ledger."""

import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from sqlalchemy.orm import Session

from app.auth.models import Membership, User
from app.billing.access import get_billing_access_status
from app.branches.models import Branch
from app.branches.scope import active_branch_id, bind_branch
from app.business_settings.models import BusinessProfile
from app.config import settings
from app.db import set_tenant_context
from app.loyalty import rewards, service
from app.loyalty.schemas import DigitalCardLink, PublicLoyaltyCard
from app.shared.exceptions import not_found
from app.storefront.models import PublicCatalog
from app.tenants.models import Tenant

AUDIENCE = "kova-loyalty-card"
CARD_TTL = timedelta(days=30)
UNAVAILABLE = "Tarjeta no disponible"


def _customer_revision(customer) -> str:
    # Reactivation cannot resurrect a previously deactivated customer's links.
    stamp = customer.updated_at
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    value = stamp.astimezone(UTC).isoformat(timespec="microseconds")
    return hashlib.sha256(value.encode()).hexdigest()


def create_link(db: Session, tenant_id: UUID, user_id: UUID, customer_id: UUID):
    customer = service._customer(db, tenant_id, customer_id, active=True)
    now = datetime.now(UTC).replace(microsecond=0)
    expires = now + CARD_TTL
    token = jwt.encode(
        {
            "aud": AUDIENCE,
            "tenant": str(tenant_id),
            "branch": str(active_branch_id(db, tenant_id)),
            "customer": str(customer.id),
            "issued_by": str(user_id),
            "revision": _customer_revision(customer),
            "iat": now,
            "exp": expires,
            "jti": str(uuid4()),
        },
        settings.secret_key,
        algorithm="HS256",
    )
    return DigitalCardLink(share_path=f"/lealtad#{token}", expires_at=expires)


def _decode(token: str):
    try:
        if len(token) > 2000:
            raise ValueError
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            audience=AUDIENCE,
            options={
                "require": [
                    "aud",
                    "tenant",
                    "branch",
                    "customer",
                    "issued_by",
                    "revision",
                    "iat",
                    "exp",
                    "jti",
                ]
            },
        )
        if (
            payload["aud"] != AUDIENCE
            or type(payload["iat"]) is not int
            or type(payload["exp"]) is not int
            or not 0 < payload["exp"] - payload["iat"] <= int(CARD_TTL.total_seconds())
            or not isinstance(payload["revision"], str)
            or len(payload["revision"]) != 64
        ):
            raise ValueError
        for field in ("tenant", "branch", "customer", "issued_by", "jti"):
            payload[field] = UUID(payload[field])
        return payload
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError, AttributeError):
        raise not_found(UNAVAILABLE) from None


def public_policy(db, tenant_id):
    revision = service._latest(db, tenant_id)
    result = service._policy_response(revision)
    if revision and not service._authorized(
        db, tenant_id, active_branch_id(db, tenant_id), revision
    ):
        result["enabled"] = False
    return result


def read_card(db: Session, token: str) -> PublicLoyaltyCard:
    payload = _decode(token)
    tenant_id, branch_id = payload["tenant"], payload["branch"]
    # The verified signature authorizes only this projection; no session or
    # privileged DB connection is created and no browser tenant/header is trusted.
    set_tenant_context(db, tenant_id)
    tenant = db.query(Tenant).filter_by(id=tenant_id, is_active=True).first()
    author = (
        db.query(Membership)
        .join(User, User.id == Membership.user_id)
        .filter(
            Membership.tenant_id == tenant_id,
            Membership.user_id == payload["issued_by"],
            Membership.role == "owner",
            Membership.is_active.is_(True),
            User.is_active.is_(True),
        )
        .first()
    )
    if (
        tenant is None
        or author is None
        or not get_billing_access_status(
            db,
            tenant_id=tenant_id,
        ).allowed
    ):
        raise not_found(UNAVAILABLE)
    branch = db.query(Branch).filter_by(tenant_id=tenant_id, id=branch_id).first()
    if branch is None or (
        author.allowed_branch_id is not None and author.allowed_branch_id != branch_id
    ):
        raise not_found(UNAVAILABLE)
    bind_branch(db, tenant_id=tenant_id, branch_id=branch_id)
    from app.customers.models import Customer

    customer = (
        db.query(Customer)
        .filter_by(
            tenant_id=tenant_id,
            id=payload["customer"],
            is_active=True,
        )
        .first()
    )
    if customer is None or not hmac.compare_digest(
        payload["revision"],
        _customer_revision(customer),
    ):
        raise not_found(UNAVAILABLE)
    profile = db.query(BusinessProfile).filter_by(tenant_id=tenant_id).first()
    catalog = (
        db.query(PublicCatalog)
        .filter_by(
            tenant_id=tenant_id,
            branch_id=branch_id,
            enabled=True,
        )
        .first()
    )
    catalog_path = None
    if catalog is not None:
        from app.storefront.router import _settings as catalog_settings

        catalog_path = catalog_settings(db, catalog).share_path
    return PublicLoyaltyCard(
        business_name=profile.public_name if profile else tenant.name,
        branch_name=branch.name,
        balance=service._balance(db, tenant_id, customer.id),
        adjustments_pending=service._pending_reversal_query(db, tenant_id, customer.id).first()
        is not None,
        policy=public_policy(db, tenant_id),
        expires_at=datetime.fromtimestamp(payload["exp"], UTC),
        catalog_path=catalog_path,
        reward=rewards.describe(rewards.available(db, tenant_id)),
    )

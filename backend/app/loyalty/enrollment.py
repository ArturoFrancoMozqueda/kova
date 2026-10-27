"""Owner-authorized, device-scoped membership. Public references are never credentials."""

import base64
import hashlib
import hmac
import io
import re
import secrets
import sys
from datetime import UTC, datetime, timedelta
from urllib.parse import quote
from uuid import UUID, uuid4

import jwt
import qrcode

from app.audit import service as audit
from app.billing.access import get_billing_access_status
from app.branches.models import Branch
from app.branches.scope import active_branch_id, bind_branch
from app.business_settings.models import BusinessProfile
from app.config import settings
from app.customers.models import Customer
from app.db import set_tenant_context
from app.idempotency import service as idempotency
from app.loyalty import cards, rewards, service
from app.loyalty.models import LoyaltyEnrollmentPolicy, LoyaltyMember
from app.loyalty.schemas import EnrollmentPolicyResponse, MemberCard, MembershipContext
from app.shared.exceptions import bad_request, conflict, forbidden, not_found
from app.storefront.links import lookup_link
from app.storefront.models import PublicCatalog
from app.tenants.models import Tenant

AUDIENCE = "kova-public-membership-device"
GRANT_AUDIENCE = "kova-public-membership-csrf"
COOKIE_PATH = "/api/v1/public/loyalty"
BOOTSTRAP_TTL = timedelta(minutes=15)
MEMBER_TTL = timedelta(days=180)
UNAVAILABLE = "Tarjeta no disponible"
RECOVERY_CONFLICT = "No se pudo confirmar esta alta en este dispositivo. Consulta al negocio."
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _digest(purpose, value):
    return hmac.new(
        settings.secret_key.encode(), f"{purpose}:{value}".encode(), hashlib.sha256
    ).hexdigest()


def _scope(catalog):
    return f"{catalog.tenant_id}:{catalog.branch_id}"


def _key(catalog, key):
    if not key or not key.strip() or len(key) > 200:
        raise bad_request("Idempotency-Key debe contener de 1 a 200 caracteres")
    return _digest("member-operation", f"{_scope(catalog)}:{key}")


def cookie_name(catalog):
    return "kova_member_" + _digest("member-cookie-name", _scope(catalog))[:24]


def _cookie_hash(catalog, token):
    return _digest("member-cookie", f"{_scope(catalog)}:{token}")


def _encode(catalog, stage, nonce, issued, expires):
    return jwt.encode(
        {
            "aud": AUDIENCE,
            "tenant": str(catalog.tenant_id),
            "branch": str(catalog.branch_id),
            "stage": stage,
            "nonce": nonce,
            "iat": issued,
            "exp": expires,
        },
        settings.secret_key,
        algorithm="HS256",
    )


def _read_cookie(request, catalog):
    name = cookie_name(catalog)
    # Reject ambiguous duplicate cookies rather than choosing a path-dependent credential.
    matches = [
        part.strip().split("=", 1)[1]
        for header in request.headers.getlist("cookie")
        for part in header.split(";")
        if part.strip().startswith(name + "=")
    ]
    if len(matches) != 1:
        return None, None
    token = matches[0]
    try:
        if len(token) > 1500:
            raise ValueError
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            audience=AUDIENCE,
            options={"require": ["aud", "tenant", "branch", "stage", "nonce", "iat", "exp"]},
        )
        ttl = BOOTSTRAP_TTL if payload["stage"] == "bootstrap" else MEMBER_TTL
        if (
            payload["aud"] != AUDIENCE
            or payload["stage"] not in {"bootstrap", "member"}
            or payload["tenant"] != str(catalog.tenant_id)
            or payload["branch"] != str(catalog.branch_id)
            or type(payload["iat"]) is not int
            or type(payload["exp"]) is not int
            or not 0 < payload["exp"] - payload["iat"] <= int(ttl.total_seconds())
            or not isinstance(payload["nonce"], str)
            or len(payload["nonce"]) != 64
        ):
            raise ValueError
        return token, payload
    except (jwt.InvalidTokenError, KeyError, ValueError, TypeError):
        return None, None


def _set_cookie(response, catalog, token, expires):
    response.set_cookie(
        cookie_name(catalog),
        token,
        path=COOKIE_PATH,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        max_age=max(0, int(expires.timestamp()) - int(datetime.now(UTC).timestamp())),
        expires=expires.astimezone(UTC),
    )


def resolve_program(db, token):
    """Resolve only the exact program; unpublished menus authorize no new member."""
    try:
        if len(token) > 1500:
            raise ValueError
        if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", token) and len(token) <= 100:
            link = lookup_link(db, token)
            if link is None:
                raise ValueError
            tenant_id, catalog_id, version = link.tenant_id, link.catalog_id, link.link_version
            branch_id = None
        else:
            payload = jwt.decode(
                token,
                settings.secret_key,
                algorithms=["HS256"],
                audience="kova-public-catalog",
                options={"require": ["tenant", "branch", "catalog", "version", "aud"]},
            )
            tenant_id, branch_id, catalog_id = (
                UUID(payload[f]) for f in ("tenant", "branch", "catalog")
            )
            version = payload["version"]
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise not_found(UNAVAILABLE) from None
    set_tenant_context(db, tenant_id)
    catalog = (
        db.query(PublicCatalog)
        .filter_by(tenant_id=tenant_id, id=catalog_id, link_version=version)
        .first()
    )
    tenant = db.query(Tenant).filter_by(id=tenant_id, is_active=True).first()
    if (
        catalog is None
        or tenant is None
        or (branch_id is not None and catalog.branch_id != branch_id)
        or not get_billing_access_status(db, tenant_id=tenant_id).allowed
    ):
        raise not_found(UNAVAILABLE)
    bind_branch(db, tenant_id=tenant_id, branch_id=catalog.branch_id)
    return catalog


def latest(db, tenant_id):
    return (
        db.query(LoyaltyEnrollmentPolicy)
        .filter_by(tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id))
        .order_by(LoyaltyEnrollmentPolicy.version.desc())
        .first()
    )


def policy(db, tenant_id):
    row = latest(db, tenant_id)
    return EnrollmentPolicyResponse(
        enabled=row.enabled if row else False, version=row.version if row else 0
    )


def available(db, catalog):
    enrollment = latest(db, catalog.tenant_id)
    points = service._latest(db, catalog.tenant_id)
    return bool(
        catalog.enabled
        and enrollment
        and enrollment.enabled
        and points
        and points.enabled
        and service._authorized(db, catalog.tenant_id, catalog.branch_id, enrollment)
        and service._authorized(db, catalog.tenant_id, catalog.branch_id, points)
    )


def save_policy(db, tenant_id, user_id, body, key):
    service._lock(db, tenant_id)
    digest, replay = service._claim(db, tenant_id, key, "enrollment-policy", body)
    if replay:
        return replay.response_status, replay.response_body
    current = latest(db, tenant_id)
    if body.expected_version != (current.version if current else 0):
        raise conflict("La política cambió; actualiza antes de guardar")
    row = LoyaltyEnrollmentPolicy(
        tenant_id=tenant_id,
        branch_id=active_branch_id(db, tenant_id),
        version=body.expected_version + 1,
        enabled=body.enabled,
        authorized_by_user_id=user_id,
    )
    db.add(row)
    db.flush()
    result = policy(db, tenant_id).model_dump(mode="json")
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="loyalty.enrollment_policy",
        resource_type=row.__tablename__,
        resource_id=row.id,
        changes={"enabled": row.enabled, "version": row.version},
    )
    idempotency.store(
        db,
        tenant_id=tenant_id,
        key=key,
        request_hash=digest,
        response_status=200,
        response_body=result,
    )
    db.commit()
    return 200, result


def _members(db, catalog):
    return db.query(LoyaltyMember).filter_by(
        tenant_id=catalog.tenant_id, branch_id=catalog.branch_id
    )


def _valid_member(db, catalog, member):
    if member is None or member.expires_at <= datetime.now(UTC):
        raise not_found(UNAVAILABLE)
    customer = (
        db.query(Customer)
        .filter_by(tenant_id=catalog.tenant_id, id=member.customer_id, is_active=True)
        .first()
    )
    author = (
        db.query(LoyaltyEnrollmentPolicy)
        .filter_by(
            tenant_id=catalog.tenant_id, branch_id=catalog.branch_id, id=member.enrollment_policy_id
        )
        .first()
    )
    if (
        customer is None
        or not hmac.compare_digest(member.customer_revision, cards._customer_revision(customer))
        or author is None
        or not service._authorized(db, catalog.tenant_id, catalog.branch_id, author)
    ):
        raise not_found(UNAVAILABLE)
    return customer


def _member_token(catalog, member):
    nonce = _digest(
        "member-credential", f"{member.id}:{member.bootstrap_hash}:{member.operation_hash}"
    )
    return _encode(catalog, "member", nonce, member.created_at, member.expires_at)


def _qr(code):
    qr = qrcode.QRCode(box_size=6, border=4)
    qr.add_data(code)
    qr.make(fit=True)
    if sys.platform == "emscripten":
        from qrcode.image.pure import PyPNGImage

        image = qr.make_image(image_factory=PyPNGImage)
    else:
        image = qr.make_image()
    output = io.BytesIO()
    image.save(output)
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


def _names(db, catalog):
    profile = db.query(BusinessProfile).filter_by(tenant_id=catalog.tenant_id).first()
    tenant = db.query(Tenant).filter_by(id=catalog.tenant_id).one()
    branch = db.query(Branch).filter_by(tenant_id=catalog.tenant_id, id=catalog.branch_id).one()
    return profile.public_name if profile else tenant.name, branch.name


def project(db, catalog, member):
    customer = _valid_member(db, catalog, member)
    business, branch = _names(db, catalog)
    from app.storefront.router import _settings

    return MemberCard(
        business_name=business,
        branch_name=branch,
        balance=service._balance(db, catalog.tenant_id, customer.id),
        adjustments_pending=service._pending_reversal_query(
            db, catalog.tenant_id, customer.id
        ).first()
        is not None,
        policy=cards.public_policy(db, catalog.tenant_id),
        expires_at=member.expires_at,
        catalog_path=_settings(db, catalog).share_path if catalog.enabled else None,
        reward=rewards.describe(rewards.available(db, catalog.tenant_id)),
        member_code=member.code,
        member_qr_data_url=_qr(member.code),
    )


def _grant(catalog, token):
    now = datetime.now(UTC).replace(microsecond=0)
    return jwt.encode(
        {
            "aud": GRANT_AUDIENCE,
            "scope": _scope(catalog),
            "cookie": _cookie_hash(catalog, token),
            "iat": now,
            "exp": now + BOOTSTRAP_TTL,
        },
        settings.secret_key,
        algorithm="HS256",
    )


def _check_grant(catalog, token, grant, alternative=None):
    try:
        if not grant or len(grant) > 1500:
            raise ValueError
        payload = jwt.decode(
            grant,
            settings.secret_key,
            algorithms=["HS256"],
            audience=GRANT_AUDIENCE,
            options={"require": ["aud", "scope", "cookie", "iat", "exp"]},
        )
        if (
            payload["scope"] != _scope(catalog)
            or payload["aud"] != GRANT_AUDIENCE
            or type(payload["iat"]) is not int
            or type(payload["exp"]) is not int
            or not 0 < payload["exp"] - payload["iat"] <= int(BOOTSTRAP_TTL.total_seconds())
            or not isinstance(payload["cookie"], str)
            or len(payload["cookie"]) != 64
            or payload["cookie"] not in {_cookie_hash(catalog, token), alternative}
        ):
            raise ValueError
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise forbidden("Actualiza la tarjeta antes de continuar") from None


def context(db, catalog, request, response, key=None):
    token, payload = _read_cookie(request, catalog)
    member = None
    if payload:
        field = "credential_hash" if payload["stage"] == "member" else "bootstrap_hash"
        member = (
            _members(db, catalog)
            .filter(getattr(LoyaltyMember, field) == _cookie_hash(catalog, token))
            .first()
        )
        if payload["stage"] == "member" and member is None:
            raise not_found(UNAVAILABLE)
    operation = _key(catalog, key) if key is not None else None
    if member:
        _valid_member(db, catalog, member)
        if operation is not None and not hmac.compare_digest(member.operation_hash, operation):
            raise conflict(RECOVERY_CONFLICT)
        if payload["stage"] == "bootstrap":
            if operation is None:
                raise conflict(RECOVERY_CONFLICT)
            token = _member_token(catalog, member)
            _set_cookie(response, catalog, token, member.expires_at)
    elif operation and _members(db, catalog).filter_by(operation_hash=operation).first():
        raise conflict(RECOVERY_CONFLICT)
    enabled = available(db, catalog)
    if member is None and not catalog.enabled:
        raise not_found(UNAVAILABLE)
    if member is None and enabled and token is None:
        now = datetime.now(UTC).replace(microsecond=0)
        token = _encode(catalog, "bootstrap", secrets.token_hex(32), now, now + BOOTSTRAP_TTL)
        _set_cookie(response, catalog, token, now + BOOTSTRAP_TTL)
    business, branch = _names(db, catalog)
    return MembershipContext(
        available=enabled,
        enrolled=member is not None,
        business_name=business,
        branch_name=branch,
        policy=cards.public_policy(db, catalog.tenant_id),
        reward=rewards.describe(rewards.available(db, catalog.tenant_id)),
        csrf_token=_grant(catalog, token) if token and (member or enabled) else None,
        card=project(db, catalog, member) if member else None,
        card_path="/lealtad?menu=" + quote(request.query_params.get("menu", ""), safe=""),
    )


def enroll(db, catalog, request, response, body, key, grant):
    operation = _key(catalog, key)
    token, payload = _read_cookie(request, catalog)
    if token is None:
        raise forbidden("Actualiza la tarjeta antes de continuar")
    service._lock(db, catalog.tenant_id)
    fingerprint = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    member = _members(db, catalog).filter_by(operation_hash=operation).first()
    if member:
        _valid_member(db, catalog, member)
        digest = _cookie_hash(catalog, token)
        if digest not in {member.bootstrap_hash, member.credential_hash} or not hmac.compare_digest(
            fingerprint, member.request_hash
        ):
            raise conflict(RECOVERY_CONFLICT)
        _check_grant(
            catalog, token, grant, member.bootstrap_hash if payload["stage"] == "member" else None
        )
    else:
        _check_grant(catalog, token, grant)
        if (
            payload["stage"] != "bootstrap"
            or _members(db, catalog).filter_by(bootstrap_hash=_cookie_hash(catalog, token)).first()
        ):
            raise conflict(RECOVERY_CONFLICT)
        if not available(db, catalog):
            raise not_found("Las altas de tarjetas no están disponibles")
        # Always create a new profile. A name or public reference never proves ownership.
        customer = Customer(
            tenant_id=catalog.tenant_id, name=body.name, email=None, phone=None, is_active=True
        )
        db.add(customer)
        db.flush()
        now = datetime.now(UTC).replace(microsecond=0)
        raw_code = "".join(secrets.choice(ALPHABET) for _ in range(16))
        member = LoyaltyMember(
            id=uuid4(),
            tenant_id=catalog.tenant_id,
            branch_id=catalog.branch_id,
            customer_id=customer.id,
            enrollment_policy_id=latest(db, catalog.tenant_id).id,
            code="KV-" + "-".join(raw_code[i : i + 4] for i in range(0, 16, 4)),
            bootstrap_hash=_cookie_hash(catalog, token),
            operation_hash=operation,
            request_hash=fingerprint,
            customer_revision=cards._customer_revision(customer),
            created_at=now,
            expires_at=now + MEMBER_TTL,
        )
        member.credential_hash = _cookie_hash(catalog, _member_token(catalog, member))
        db.add(member)
        db.flush()
        # Only identifiers and categorical consent are recorded, never credentials or alias.
        author = (
            db.query(LoyaltyEnrollmentPolicy)
            .filter_by(id=member.enrollment_policy_id, tenant_id=catalog.tenant_id)
            .one()
        )
        audit.log(
            db,
            tenant_id=catalog.tenant_id,
            user_id=author.authorized_by_user_id,
            action="loyalty.public_enrollment",
            resource_type="loyalty_members",
            resource_id=member.id,
            changes={"confirmed": True},
        )
    result = {
        "card": project(db, catalog, member),
        "card_path": "/lealtad?menu=" + quote(body.menu_token, safe=""),
    }
    final_token, expires = _member_token(catalog, member), member.expires_at
    db.commit()
    _set_cookie(response, catalog, final_token, expires)
    return result


def resolve_code(db, tenant_id, code):
    branch_id = active_branch_id(db, tenant_id)
    normalized = re.sub(r"[\s-]", "", code.upper())
    if not re.fullmatch(r"KV[" + ALPHABET + r"]{16}", normalized):
        raise not_found(UNAVAILABLE)
    canonical = "KV-" + "-".join(normalized[i : i + 4] for i in range(2, 18, 4))
    member = (
        db.query(LoyaltyMember)
        .filter_by(tenant_id=tenant_id, branch_id=branch_id, code=canonical)
        .first()
    )
    catalog = db.query(PublicCatalog).filter_by(tenant_id=tenant_id, branch_id=branch_id).first()
    if catalog is None:
        raise not_found(UNAVAILABLE)
    customer = _valid_member(db, catalog, member)
    return {"customer": {"id": customer.id, "name": customer.name, "is_active": customer.is_active}}

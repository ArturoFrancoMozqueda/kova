import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import bcrypt
import jwt
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth import repository as repo
from app.auth.models import Membership, User, UserSession
from app.auth.schemas import MeResponse, UserResponse
from app.config import settings
from app.shared.exceptions import bad_request, forbidden, unauthorized
from app.tenants import repository as tenant_repo

# ── Passwords ─────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── Tokens ────────────────────────────────────────────────────────────────────

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _generate_token() -> str:
    return secrets.token_urlsafe(32)


def create_access_token(user_id: UUID, tenant_id: UUID, session_id: UUID) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "tid": str(tenant_id),
        "jti": str(session_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=settings.access_token_ttl_seconds)).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise unauthorized("Session expired") from exc
    except jwt.InvalidTokenError as exc:
        raise unauthorized("Invalid token") from exc


# ── Slug ──────────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:100] or "tenant"


def _unique_slug(db: Session, base: str) -> str:
    slug = base
    counter = 1
    while tenant_repo.get_by_slug(db, slug):
        slug = f"{base}-{counter}"
        counter += 1
    return slug


# ── Signup ────────────────────────────────────────────────────────────────────

def signup(
    db: Session,
    *,
    email: str,
    password: str,
    tenant_name: str,
    ip_address: str | None = None,
) -> tuple[User, UUID, str]:
    """Returns (user, tenant_id, verification_token_plain)."""
    if repo.get_user_by_email(db, email):
        raise bad_request("Email already registered")

    hashed = hash_password(password)
    user = repo.create_user(db, email=email, hashed_password=hashed)

    slug = _unique_slug(db, _slugify(tenant_name))
    tenant = tenant_repo.create(db, name=tenant_name, slug=slug)
    repo.create_membership(db, tenant_id=tenant.id, user_id=user.id, role="owner")

    plain_token = _generate_token()
    repo.create_verification_token(
        db,
        user_id=user.id,
        token_hash=_hash_token(plain_token),
        token_type="email_verification",
        expires_at=datetime.now(UTC) + timedelta(seconds=settings.token_ttl_seconds),
    )

    audit_service.log(
        db,
        action="user.signup",
        tenant_id=tenant.id,
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=ip_address,
    )

    db.commit()
    return user, tenant.id, plain_token


# ── Verify email ──────────────────────────────────────────────────────────────

def verify_email(db: Session, *, token: str) -> None:
    vt = repo.get_verification_token(db, _hash_token(token), "email_verification")
    if not vt:
        raise bad_request("Invalid or expired verification token")
    repo.mark_token_used(db, vt)
    user = repo.get_user_by_id(db, vt.user_id)
    if user:
        repo.set_email_verified(db, user)
    db.commit()


# ── Login ─────────────────────────────────────────────────────────────────────

def login(
    db: Session,
    *,
    email: str,
    password: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> tuple[str, str, UserSession]:
    """Returns (access_token, refresh_token_plain, session)."""
    user = repo.get_user_by_email(db, email)
    if not user or not verify_password(password, user.hashed_password):
        raise unauthorized("Invalid credentials")
    if not user.is_email_verified:
        raise forbidden("Email not verified")
    if not user.is_active:
        raise forbidden("Account inactive")

    membership = repo.get_membership_by_user(db, user.id)
    if not membership:
        raise forbidden("No active membership")

    refresh_plain = _generate_token()
    now = datetime.now(UTC)
    session = repo.create_session(
        db,
        user_id=user.id,
        tenant_id=membership.tenant_id,
        refresh_token_hash=_hash_token(refresh_plain),
        expires_at=now + timedelta(seconds=settings.refresh_token_ttl_seconds),
        ip_address=ip_address,
        user_agent=user_agent,
    )

    access_token = create_access_token(user.id, membership.tenant_id, session.id)

    audit_service.log(
        db,
        action="user.login",
        tenant_id=membership.tenant_id,
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=ip_address,
    )

    db.commit()
    return access_token, refresh_plain, session


# ── Refresh ───────────────────────────────────────────────────────────────────

def refresh_session(db: Session, *, refresh_token: str) -> tuple[str, str]:
    """Returns (new_access_token, new_refresh_token_plain)."""
    session = repo.get_session_by_refresh_hash(db, _hash_token(refresh_token))
    now = datetime.now(UTC)

    if not session or session.revoked_at or session.expires_at.replace(tzinfo=UTC) < now:
        raise unauthorized("Invalid or expired refresh token")

    new_refresh = _generate_token()
    repo.rotate_refresh_token(
        db,
        session,
        new_hash=_hash_token(new_refresh),
        new_expires_at=now + timedelta(seconds=settings.refresh_token_ttl_seconds),
    )
    new_access = create_access_token(session.user_id, session.tenant_id, session.id)
    db.commit()
    return new_access, new_refresh


# ── Logout ────────────────────────────────────────────────────────────────────

def logout(db: Session, *, session: UserSession, ip_address: str | None = None) -> None:
    audit_service.log(
        db,
        action="user.logout",
        tenant_id=session.tenant_id,
        user_id=session.user_id,
        resource_type="session",
        resource_id=session.id,
        ip_address=ip_address,
    )
    repo.revoke_session(db, session)
    db.commit()


def logout_all(
    db: Session, *, user_id: UUID, tenant_id: UUID, ip_address: str | None = None
) -> None:
    audit_service.log(
        db,
        action="user.logout_all",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="user",
        resource_id=user_id,
        ip_address=ip_address,
    )
    repo.revoke_all_sessions(db, user_id)
    db.commit()


# ── Password reset ────────────────────────────────────────────────────────────

def request_password_reset(db: Session, *, email: str) -> str | None:
    """Returns plain token (dev only). Always succeeds to not leak email existence."""
    user = repo.get_user_by_email(db, email)
    if not user:
        return None
    plain = _generate_token()
    repo.create_verification_token(
        db,
        user_id=user.id,
        token_hash=_hash_token(plain),
        token_type="password_reset",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db.commit()
    return plain


def confirm_password_reset(db: Session, *, token: str, new_password: str) -> None:
    vt = repo.get_verification_token(db, _hash_token(token), "password_reset")
    if not vt:
        raise bad_request("Invalid or expired reset token")
    user = repo.get_user_by_id(db, vt.user_id)
    if not user:
        raise bad_request("Invalid reset token")
    membership = repo.get_membership_by_user(db, user.id)
    repo.mark_token_used(db, vt)
    repo.update_password(db, user, hash_password(new_password))
    repo.revoke_all_sessions(db, user.id)
    audit_service.log(
        db,
        action="user.password_reset",
        tenant_id=membership.tenant_id if membership else None,
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
    )
    db.commit()


# ── Me ────────────────────────────────────────────────────────────────────────

def get_me(db: Session, *, user: User, membership: Membership) -> MeResponse:
    tenant = tenant_repo.get_by_id(db, membership.tenant_id)
    return MeResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            tenant_id=membership.tenant_id,
            role=membership.role,
        ),
        tenant_id=membership.tenant_id,
        tenant_name=tenant.name if tenant else "",
    )

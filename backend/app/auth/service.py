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
from app.email import service as email_service
from app.shared.exceptions import bad_request, forbidden, unauthorized
from app.tenants import repository as tenant_repo
from app.tenants.feature_flags import resolve_feature_flags

# ── Passwords ─────────────────────────────────────────────────────────────────

_BCRYPT_ROUNDS = 12


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# A throwaway hash used to equalize login timing when the email is unknown. Verifying
# against it costs the same bcrypt work as a real account, so response time can't be
# used to tell whether an email is registered. Computed once at import.
_DUMMY_PASSWORD_HASH = hash_password("timing-equalizer-not-a-real-password")


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

class SignupOutcome:
    """Result of a signup attempt.

    `reason` lets the frontend distinguish the three branches without leaking
    extra fields. The shape is intentionally identical across branches so the
    response body cannot be used as an enumeration oracle beyond the reason
    code itself — which the user already learns from the resulting email.
    """

    ACCOUNT_CREATED = "account_created"
    VERIFICATION_RESENT = "verification_resent"
    EMAIL_IN_USE = "email_in_use"

    def __init__(
        self,
        reason: str,
        *,
        user: User | None = None,
        tenant_id: UUID | None = None,
        verification_token_plain: str | None = None,
    ) -> None:
        self.reason = reason
        self.user = user
        self.tenant_id = tenant_id
        self.verification_token_plain = verification_token_plain


def signup(
    db: Session,
    *,
    email: str,
    password: str,
    tenant_name: str,
    accepted_terms: bool,
    ip_address: str | None = None,
) -> SignupOutcome:
    """Create a tenant or recover an in-progress signup.

    `accepted_terms` is the user's explicit consent to the privacy notice and
    terms of service. It is required to create a brand new account; the
    timestamp and IP are persisted on `users` for LFPDPPP / GDPR evidence.
    Recovery branches (existing account) do not re-record consent.
    """
    if not accepted_terms:
        raise bad_request("Terms and privacy notice must be accepted")
    existing = repo.get_user_by_email(db, email)
    if existing is not None:
        membership = repo.get_membership_by_user(db, existing.id)
        tenant_id = membership.tenant_id if membership else None
        if existing.is_email_verified:
            audit_service.log(
                db,
                action="user.signup_blocked_existing",
                tenant_id=tenant_id,
                user_id=existing.id,
                resource_type="user",
                resource_id=existing.id,
                ip_address=ip_address,
            )
            db.commit()
            return SignupOutcome(SignupOutcome.EMAIL_IN_USE)

        # Unverified existing user — reissue verification token and resend.
        repo.invalidate_pending_tokens(
            db, user_id=existing.id, token_type="email_verification"
        )
        plain_token = _generate_token()
        repo.create_verification_token(
            db,
            user_id=existing.id,
            token_hash=_hash_token(plain_token),
            token_type="email_verification",
            expires_at=datetime.now(UTC) + timedelta(seconds=settings.token_ttl_seconds),
        )
        audit_service.log(
            db,
            action="user.signup_verification_resent",
            tenant_id=tenant_id,
            user_id=existing.id,
            resource_type="user",
            resource_id=existing.id,
            ip_address=ip_address,
        )
        db.commit()
        email_service.send_verification_email(to=existing.email, token=plain_token)
        return SignupOutcome(
            SignupOutcome.VERIFICATION_RESENT,
            verification_token_plain=plain_token,
        )

    hashed = hash_password(password)
    user = repo.create_user(
        db,
        email=email,
        hashed_password=hashed,
        terms_accepted_at=datetime.now(UTC),
        terms_accepted_ip=ip_address,
    )

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
    email_service.send_verification_email(to=user.email, token=plain_token)
    return SignupOutcome(
        SignupOutcome.ACCOUNT_CREATED,
        user=user,
        tenant_id=tenant.id,
        verification_token_plain=plain_token,
    )


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
    if not user:
        # Pay the same bcrypt cost as a real account so timing doesn't leak whether
        # the email exists, then fail with the same generic error.
        verify_password(password, _DUMMY_PASSWORD_HASH)
        raise unauthorized("Invalid credentials")
    if not verify_password(password, user.hashed_password):
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

    # Absolute lifetime cap: rotation can't keep a session alive forever. Once a
    # session is older than the absolute TTL from creation, force a fresh login.
    absolute_deadline = session.created_at.replace(tzinfo=UTC) + timedelta(
        seconds=settings.refresh_token_absolute_ttl_seconds
    )
    if now >= absolute_deadline:
        repo.revoke_session(db, session)
        db.commit()
        raise unauthorized("Session lifetime exceeded")

    new_refresh = _generate_token()
    # Never extend the sliding window past the absolute deadline.
    new_expires_at = min(
        now + timedelta(seconds=settings.refresh_token_ttl_seconds),
        absolute_deadline,
    )
    repo.rotate_refresh_token(
        db,
        session,
        new_hash=_hash_token(new_refresh),
        new_expires_at=new_expires_at,
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
    # Invalidate any previously issued reset links so only the newest one works.
    repo.invalidate_pending_tokens(db, user_id=user.id, token_type="password_reset")
    plain = _generate_token()
    repo.create_verification_token(
        db,
        user_id=user.id,
        token_hash=_hash_token(plain),
        token_type="password_reset",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db.commit()
    if plain:
        email_service.send_password_reset_email(to=email, token=plain)
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
    # Burn any other outstanding reset links for this user, not just the one used.
    repo.invalidate_pending_tokens(db, user_id=user.id, token_type="password_reset")
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
        feature_flags=resolve_feature_flags(tenant.feature_overrides if tenant else None),
    )

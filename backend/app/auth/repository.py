from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.auth.models import Membership, User, UserSession, VerificationToken

# ── Users ─────────────────────────────────────────────────────────────────────

def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: UUID) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def create_user(
    db: Session,
    *,
    email: str,
    hashed_password: str,
    terms_accepted_at: datetime | None = None,
    terms_accepted_ip: str | None = None,
) -> User:
    now = datetime.now(UTC)
    user = User(
        email=email,
        hashed_password=hashed_password,
        terms_accepted_at=terms_accepted_at,
        terms_accepted_ip=terms_accepted_ip,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.flush()
    return user


def set_email_verified(db: Session, user: User) -> None:
    user.is_email_verified = True
    user.updated_at = datetime.now(UTC)
    db.flush()


def update_password(db: Session, user: User, hashed_password: str) -> None:
    user.hashed_password = hashed_password
    user.updated_at = datetime.now(UTC)
    db.flush()


# ── Memberships ───────────────────────────────────────────────────────────────

def create_membership(db: Session, *, tenant_id: UUID, user_id: UUID, role: str) -> Membership:
    m = Membership(tenant_id=tenant_id, user_id=user_id, role=role, created_at=datetime.now(UTC))
    db.add(m)
    db.flush()
    return m


def get_membership(db: Session, *, user_id: UUID, tenant_id: UUID) -> Membership | None:
    return (
        db.query(Membership)
        .filter(
            Membership.user_id == user_id,
            Membership.tenant_id == tenant_id,
            Membership.is_active.is_(True),
        )
        .first()
    )


def get_membership_including_inactive(
    db: Session, *, user_id: UUID, tenant_id: UUID
) -> Membership | None:
    return (
        db.query(Membership)
        .filter(Membership.user_id == user_id, Membership.tenant_id == tenant_id)
        .first()
    )


def get_membership_by_user(db: Session, user_id: UUID) -> Membership | None:
    return (
        db.query(Membership)
        .filter(Membership.user_id == user_id, Membership.is_active.is_(True))
        .first()
    )


# ── Sessions ──────────────────────────────────────────────────────────────────

def create_session(
    db: Session,
    *,
    user_id: UUID,
    tenant_id: UUID,
    refresh_token_hash: str,
    expires_at: datetime,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> UserSession:
    s = UserSession(
        user_id=user_id,
        tenant_id=tenant_id,
        refresh_token_hash=refresh_token_hash,
        expires_at=expires_at,
        ip_address=ip_address,
        user_agent=user_agent,
        created_at=datetime.now(UTC),
    )
    db.add(s)
    db.flush()
    return s


def get_session_by_refresh_hash(db: Session, token_hash: str) -> UserSession | None:
    return db.query(UserSession).filter(UserSession.refresh_token_hash == token_hash).first()


def get_session_by_id(db: Session, session_id: UUID) -> UserSession | None:
    return db.query(UserSession).filter(UserSession.id == session_id).first()


def revoke_session(db: Session, session: UserSession) -> None:
    session.revoked_at = datetime.now(UTC)
    db.flush()


def revoke_all_sessions(db: Session, user_id: UUID) -> None:
    now = datetime.now(UTC)
    db.query(UserSession).filter(
        UserSession.user_id == user_id,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": now})
    db.flush()


def rotate_refresh_token(
    db: Session, session: UserSession, new_hash: str, new_expires_at: datetime
) -> None:
    session.refresh_token_hash = new_hash
    session.expires_at = new_expires_at
    db.flush()


# ── Verification tokens ───────────────────────────────────────────────────────

def create_verification_token(
    db: Session,
    *,
    user_id: UUID,
    token_hash: str,
    token_type: str,
    expires_at: datetime,
) -> VerificationToken:
    now = datetime.now(UTC)
    vt = VerificationToken(
        user_id=user_id,
        token_hash=token_hash,
        token_type=token_type,
        expires_at=expires_at,
        created_at=now,
    )
    db.add(vt)
    db.flush()
    return vt


def get_verification_token(
    db: Session, token_hash: str, token_type: str
) -> VerificationToken | None:
    now = datetime.now(UTC)
    # Lock the matched row FOR UPDATE so two concurrent verify/confirm requests
    # carrying the same token can't both observe `used_at IS NULL` and consume it
    # — the second waits, then sees it already used. Callers run inside a
    # committing transaction, so the lock is held until consumption completes.
    return (
        db.query(VerificationToken)
        .filter(
            VerificationToken.token_hash == token_hash,
            VerificationToken.token_type == token_type,
            VerificationToken.expires_at > now,
            VerificationToken.used_at.is_(None),
        )
        .with_for_update()
        .first()
    )


def mark_token_used(db: Session, vt: VerificationToken) -> None:
    vt.used_at = datetime.now(UTC)
    db.flush()


def invalidate_pending_tokens(db: Session, *, user_id: UUID, token_type: str) -> int:
    """Mark all unused, unexpired tokens of `token_type` for `user_id` as used.

    Used when re-issuing a verification token so the previous link stops working.
    Returns the number of tokens invalidated.
    """
    now = datetime.now(UTC)
    count = (
        db.query(VerificationToken)
        .filter(
            VerificationToken.user_id == user_id,
            VerificationToken.token_type == token_type,
            VerificationToken.used_at.is_(None),
        )
        .update({"used_at": now})
    )
    db.flush()
    return count

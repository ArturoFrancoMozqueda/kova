"""TOTP step-up authentication for the single Kova Ops founder principal."""

import base64
import hashlib
import hmac
import io
import re
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pyotp
import qrcode
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.auth.models import OpsMfaFactor, OpsMfaRecoveryCode, User, UserSession
from app.auth.service import verify_password
from app.config import settings
from app.shared.exceptions import conflict, forbidden

_ISSUER = "Kova Ops"
_RECOVERY_COUNT = 10
_RECOVERY_NORMALIZER = re.compile(r"[^A-Z0-9]")


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _root_key() -> bytes:
    configured = settings.internal_ops_mfa_root_key
    if configured is None:
        raise HTTPException(status_code=503, detail="MFA is not configured")
    value = configured.get_secret_value()
    if len(value) < 32:
        raise HTTPException(status_code=503, detail="MFA is not configured")
    return value.encode("utf-8")


def totp_secret(user_id: UUID) -> str:
    """Derive a stable per-user seed without persisting it in Postgres."""
    digest = hmac.new(
        _root_key(),
        b"kova-ops-totp-v1\0" + user_id.bytes,
        hashlib.sha256,
    ).digest()
    return base64.b32encode(digest).decode("ascii").rstrip("=")


def _totp(user_id: UUID) -> pyotp.TOTP:
    return pyotp.TOTP(totp_secret(user_id), digits=6, interval=30)


def _qr_data_url(uri: str) -> str:
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=7,
        border=4,
    )
    qr.add_data(uri)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _enrollment_key_is_valid(candidate: str) -> bool:
    configured = settings.internal_ops_mfa_enrollment_key
    if configured is None:
        return False
    return secrets.compare_digest(
        candidate.encode("utf-8"),
        configured.get_secret_value().encode("utf-8"),
    )


def setup_payload(
    db: Session,
    *,
    user: User,
    password: str,
    enrollment_key: str,
) -> tuple[str, str]:
    if not verify_password(password, user.hashed_password):
        raise forbidden("La contraseña no es correcta")
    if not _enrollment_key_is_valid(enrollment_key):
        raise forbidden("La clave de enrolamiento no es correcta")
    if db.get(OpsMfaFactor, user.id) is not None:
        raise conflict("MFA ya está configurado")
    secret = totp_secret(user.id)
    uri = _totp(user.id).provisioning_uri(name=user.email, issuer_name=_ISSUER)
    return secret, _qr_data_url(uri)


def _accepted_counter(user_id: UUID, code: str, *, last_used: int) -> int | None:
    if not re.fullmatch(r"\d{6}", code):
        return None
    totp = _totp(user_id)
    current = totp.timecode(_now())
    for counter in range(current - 1, current + 2):
        if counter <= last_used:
            continue
        if pyotp.utils.strings_equal(code, totp.generate_otp(counter)):
            return counter
    return None


def _format_recovery_code() -> str:
    raw = base64.b32encode(secrets.token_bytes(16)).decode("ascii").rstrip("=")
    return "KOVA-" + "-".join(raw[index : index + 5] for index in range(0, len(raw), 5))


def _normalize_recovery_code(code: str) -> str:
    return _RECOVERY_NORMALIZER.sub("", code.upper())


def _recovery_hash(code: str) -> str:
    return hashlib.sha256(_normalize_recovery_code(code).encode("utf-8")).hexdigest()


def _new_recovery_codes(db: Session, *, user_id: UUID, now: datetime) -> list[str]:
    codes = [_format_recovery_code() for _ in range(_RECOVERY_COUNT)]
    db.add_all(
        OpsMfaRecoveryCode(
            user_id=user_id,
            code_hash=_recovery_hash(code),
            created_at=now,
        )
        for code in codes
    )
    return codes


def confirm_enrollment(
    db: Session,
    *,
    user: User,
    session: UserSession,
    password: str,
    enrollment_key: str,
    code: str,
    ip_address: str | None,
) -> list[str]:
    locked_user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if locked_user is None or not verify_password(password, locked_user.hashed_password):
        raise forbidden("La contraseña no es correcta")
    if not _enrollment_key_is_valid(enrollment_key):
        raise forbidden("La clave de enrolamiento no es correcta")
    if db.get(OpsMfaFactor, user.id) is not None:
        raise conflict("MFA ya está configurado")
    counter = _accepted_counter(user.id, code, last_used=-1)
    if counter is None:
        raise forbidden("Código inválido")

    now = _now()
    db.add(
        OpsMfaFactor(
            user_id=user.id,
            last_used_counter=counter,
            enabled_at=now,
            updated_at=now,
        )
    )
    recovery_codes = _new_recovery_codes(db, user_id=user.id, now=now)
    session.ops_mfa_verified_at = now
    audit_service.log(
        db,
        action="ops.mfa.enabled",
        tenant_id=session.tenant_id,
        user_id=user.id,
        resource_type="user",
        resource_id=user.id,
        ip_address=ip_address,
    )
    db.commit()
    return recovery_codes


def _consume_totp(db: Session, *, user_id: UUID, code: str) -> bool:
    factor = db.scalar(
        select(OpsMfaFactor).where(OpsMfaFactor.user_id == user_id).with_for_update()
    )
    if factor is None:
        return False
    counter = _accepted_counter(user_id, code, last_used=factor.last_used_counter)
    if counter is None:
        return False
    factor.last_used_counter = counter
    factor.updated_at = _now()
    return True


def _consume_recovery_code(db: Session, *, user_id: UUID, code: str) -> bool:
    if not _normalize_recovery_code(code).startswith("KOVA"):
        return False
    recovery = db.scalar(
        select(OpsMfaRecoveryCode)
        .where(
            OpsMfaRecoveryCode.user_id == user_id,
            OpsMfaRecoveryCode.code_hash == _recovery_hash(code),
            OpsMfaRecoveryCode.used_at.is_(None),
        )
        .with_for_update()
    )
    if recovery is None:
        return False
    recovery.used_at = _now()
    return True


def verify_step_up(
    db: Session,
    *,
    user: User,
    session: UserSession,
    code: str,
    ip_address: str | None,
) -> bool:
    used_recovery = _consume_recovery_code(db, user_id=user.id, code=code)
    if not used_recovery and not _consume_totp(db, user_id=user.id, code=code):
        raise forbidden("Código inválido")
    now = _now()
    session.ops_mfa_verified_at = now
    audit_service.log(
        db,
        action="ops.mfa.recovery_used" if used_recovery else "ops.mfa.verified",
        tenant_id=session.tenant_id,
        user_id=user.id,
        resource_type="session",
        resource_id=session.id,
        ip_address=ip_address,
    )
    db.commit()
    return used_recovery


def factor_exists(db: Session, *, user_id: UUID) -> bool:
    return db.get(OpsMfaFactor, user_id) is not None


def recovery_codes_remaining(db: Session, *, user_id: UUID) -> int:
    return int(
        db.scalar(
            select(func.count(OpsMfaRecoveryCode.id)).where(
                OpsMfaRecoveryCode.user_id == user_id,
                OpsMfaRecoveryCode.used_at.is_(None),
            )
        )
        or 0
    )


def step_up_is_valid(session: UserSession) -> bool:
    verified_at = session.ops_mfa_verified_at
    if verified_at is None:
        return False
    expires_at = _as_utc(verified_at) + timedelta(
        seconds=settings.internal_ops_mfa_step_up_ttl_seconds
    )
    return expires_at > _now()

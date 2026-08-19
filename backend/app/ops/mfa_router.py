import hashlib

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db import get_privileged_db
from app.middleware.rate_limit import enforce_rate_limit, rate_limit
from app.ops import mfa
from app.ops.dependencies import InternalAdminContext, require_internal_founder
from app.ops.schemas import (
    OpsMfaConfirmRequest,
    OpsMfaConfirmResponse,
    OpsMfaPasswordRequest,
    OpsMfaSetupResponse,
    OpsMfaStatusResponse,
    OpsMfaVerifyRequest,
    OpsMfaVerifyResponse,
)

router = APIRouter(
    prefix="/api/v1/internal/ops/mfa",
    tags=["internal-ops-mfa"],
    dependencies=[
        Depends(rate_limit(20, key="internal-ops-mfa", fail_closed=True)),
        Depends(require_internal_founder),
    ],
)


def _enforce_account_limit(user_id: object, operation: str) -> None:
    digest = hashlib.sha256(str(user_id).encode()).hexdigest()
    enforce_rate_limit(
        bucket_key=f"ops-mfa-{operation}:{digest}",
        max_requests=5,
        window_seconds=300,
        fail_closed=True,
    )


@router.get("/status", response_model=OpsMfaStatusResponse)
def status(
    ctx: InternalAdminContext = Depends(require_internal_founder),
    db: Session = Depends(get_privileged_db),
) -> OpsMfaStatusResponse:
    enrolled = mfa.factor_exists(db, user_id=ctx.user.id)
    return OpsMfaStatusResponse(
        enrolled=enrolled,
        step_up_valid=enrolled and mfa.step_up_is_valid(ctx.session),
        recovery_codes_remaining=mfa.recovery_codes_remaining(db, user_id=ctx.user.id),
    )


@router.post("/setup", response_model=OpsMfaSetupResponse)
def setup(
    body: OpsMfaPasswordRequest,
    ctx: InternalAdminContext = Depends(require_internal_founder),
    db: Session = Depends(get_privileged_db),
) -> OpsMfaSetupResponse:
    _enforce_account_limit(ctx.user.id, "setup")
    secret, qr_data_url = mfa.setup_payload(
        db,
        user=ctx.user,
        password=body.password,
        enrollment_key=body.enrollment_key,
    )
    return OpsMfaSetupResponse(secret=secret, qr_png_data_url=qr_data_url)


@router.post("/confirm", response_model=OpsMfaConfirmResponse)
def confirm(
    body: OpsMfaConfirmRequest,
    request: Request,
    ctx: InternalAdminContext = Depends(require_internal_founder),
    db: Session = Depends(get_privileged_db),
) -> OpsMfaConfirmResponse:
    _enforce_account_limit(ctx.user.id, "confirm")
    recovery_codes = mfa.confirm_enrollment(
        db,
        user=ctx.user,
        session=ctx.session,
        password=body.password,
        enrollment_key=body.enrollment_key,
        code=body.code,
        ip_address=request.client.host if request.client else None,
    )
    return OpsMfaConfirmResponse(recovery_codes=recovery_codes)


@router.post("/verify", response_model=OpsMfaVerifyResponse)
def verify(
    body: OpsMfaVerifyRequest,
    request: Request,
    ctx: InternalAdminContext = Depends(require_internal_founder),
    db: Session = Depends(get_privileged_db),
) -> OpsMfaVerifyResponse:
    _enforce_account_limit(ctx.user.id, "verify")
    used_recovery = mfa.verify_step_up(
        db,
        user=ctx.user,
        session=ctx.session,
        code=body.code,
        ip_address=request.client.host if request.client else None,
    )
    return OpsMfaVerifyResponse(used_recovery_code=used_recovery)

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.schemas import (
    LoginRequest,
    MeResponse,
    MessageResponse,
    PasswordResetConfirmBody,
    PasswordResetRequestBody,
    SessionProbeResponse,
    SignupRequest,
    SignupResponse,
    VerifyEmailRequest,
)
from app.config import settings
from app.db import get_db, get_privileged_db
from app.middleware.csrf import clear_csrf_cookie, set_csrf_cookie
from app.middleware.rate_limit import enforce_rate_limit, rate_limit
from app.shared.dependencies import get_current_session

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _account_bucket(prefix: str, email: str) -> str:
    """Per-account rate-limit bucket keyed by a SHA-256 of the (already
    normalized) email, so raw addresses are never written into the rate-limiter
    store (e.g. Redis keys)."""
    digest = hashlib.sha256(email.encode()).hexdigest()
    return f"{prefix}:{digest}"


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    secure = settings.cookie_secure
    response.set_cookie(
        "access_token", access_token,
        httponly=True, secure=secure, samesite="lax",
        max_age=settings.access_token_ttl_seconds, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh_token,
        httponly=True, secure=secure, samesite="lax",
        max_age=settings.refresh_token_ttl_seconds, path="/api/v1/auth",
    )
    set_csrf_cookie(response)


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/v1/auth")
    clear_csrf_cookie(response)


@router.post(
    "/signup", response_model=SignupResponse,
    dependencies=[Depends(rate_limit(10, key="auth-signup", fail_closed=True))],
)
def signup(
    body: SignupRequest,
    request: Request,
    response: Response,
    # Pre-session: creates a brand-new tenant + its first membership/subscription
    # before any tenant context exists. Runs on the privileged engine (RLS bypass);
    # there is no cross-tenant read, only inserts for the tenant just created.
    db: Session = Depends(get_privileged_db),
):
    # Per-account throttle (in addition to the per-IP dependency) so signup spam
    # against one address can't slip through a botnet of rotating IPs.
    enforce_rate_limit(
        bucket_key=_account_bucket("auth-signup-acct", body.email),
        max_requests=5, window_seconds=3600, fail_closed=True,
    )
    outcome = service.signup(
        db,
        email=body.email,
        password=body.password,
        tenant_name=body.tenant_name,
        accepted_terms=body.accepted_terms,
        ip_address=request.client.host if request.client else None,
    )
    dev_token = (
        outcome.verification_token_plain
        if settings.app_env == "local"
        else None
    )
    messages = {
        service.SignupOutcome.ACCOUNT_CREATED:
            "Account created. Verify your email to log in.",
        service.SignupOutcome.VERIFICATION_RESENT:
            "Verification email re-sent.",
        service.SignupOutcome.EMAIL_IN_USE:
            "Email already has an account. Sign in to continue.",
    }
    response.status_code = (
        201 if outcome.reason == service.SignupOutcome.ACCOUNT_CREATED else 200
    )
    return SignupResponse(
        message=messages[outcome.reason],
        reason=outcome.reason,
        user_id=outcome.user.id if outcome.user else None,
        tenant_id=outcome.tenant_id,
        dev_verification_token=dev_token,
    )


@router.post(
    "/verify", response_model=MessageResponse,
    dependencies=[Depends(rate_limit(20, key="auth-verify", fail_closed=True))],
)
def verify_email(body: VerifyEmailRequest, db: Session = Depends(get_privileged_db)):
    service.verify_email(db, token=body.token)
    return MessageResponse(message="Email verified.")


@router.post("/login", dependencies=[Depends(rate_limit(20, key="auth-login", fail_closed=True))])
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    # Pre-session: resolves the user's tenant/membership across tenants and mints
    # a session before any tenant context exists. Privileged engine (RLS bypass).
    db: Session = Depends(get_privileged_db),
):
    # Per-account throttle bounds distributed password-spraying against a single
    # account that the per-IP limit alone would miss. Window is short and the cap
    # generous so a real user is essentially never tripped, keeping the worst-case
    # targeted lockout brief (see docs / plan: failure-only counting is a follow-up).
    enforce_rate_limit(
        bucket_key=_account_bucket("auth-login-acct", body.email),
        max_requests=10, window_seconds=600, fail_closed=True,
    )
    access_token, refresh_token, _ = service.login(
        db,
        email=body.email,
        password=body.password,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    _set_auth_cookies(response, access_token, refresh_token)
    return {"message": "Logged in."}


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_privileged_db)):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        from app.shared.exceptions import unauthorized
        raise unauthorized("No refresh token")
    new_access, new_refresh = service.refresh_session(db, refresh_token=refresh_token)
    _set_auth_cookies(response, new_access, new_refresh)
    return {"message": "Token refreshed."}


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(get_current_session),
):
    _, _, session = ctx
    ip = request.client.host if request.client else None
    service.logout(db, session=session, ip_address=ip)
    _clear_auth_cookies(response)


@router.post("/logout-all", status_code=204)
def logout_all(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    ctx=Depends(get_current_session),
):
    user, membership, _ = ctx
    service.logout_all(
        db,
        user_id=user.id,
        tenant_id=membership.tenant_id,
        ip_address=request.client.host if request.client else None,
    )
    _clear_auth_cookies(response)


@router.post(
    "/password-reset/request", response_model=MessageResponse,
    dependencies=[Depends(rate_limit(5, key="auth-password-reset", fail_closed=True))],
)
def password_reset_request(
    body: PasswordResetRequestBody, db: Session = Depends(get_privileged_db)
):
    # Per-account throttle so reset-email spam can't be aimed at one victim from
    # many IPs (and keeps the anti-enumeration response cheap).
    enforce_rate_limit(
        bucket_key=_account_bucket("auth-reset-acct", body.email),
        max_requests=5, window_seconds=3600, fail_closed=True,
    )
    plain = service.request_password_reset(db, email=body.email)
    dev_token = plain if settings.app_env == "local" else None
    msg = "If that email exists, a reset link has been sent."
    return MessageResponse(message=msg, dev_reset_token=dev_token)


@router.post(
    "/password-reset/confirm", response_model=MessageResponse,
    dependencies=[Depends(rate_limit(10, key="auth-reset-confirm", fail_closed=True))],
)
def password_reset_confirm(
    body: PasswordResetConfirmBody, db: Session = Depends(get_privileged_db)
):
    service.confirm_password_reset(db, token=body.token, new_password=body.new_password)
    return MessageResponse(message="Password updated.")


@router.get("/me", response_model=MeResponse)
def me(db: Session = Depends(get_db), ctx=Depends(get_current_session)):
    user, membership, _ = ctx
    return service.get_me(db, user=user, membership=membership)


@router.get("/session", response_model=SessionProbeResponse)
def session_probe(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    try:
        user, membership, _ = get_current_session(request, db)
    except HTTPException as exc:
        if exc.status_code in {401, 403}:
            return SessionProbeResponse(authenticated=False)
        raise

    # Lazily issue a CSRF token for authenticated sessions that don't have one
    # yet (e.g. users whose session predates the CSRF rollout).
    if not request.cookies.get("csrf_token"):
        set_csrf_cookie(response)

    me_response = service.get_me(db, user=user, membership=membership)
    return SessionProbeResponse(
        authenticated=True,
        user=me_response.user,
        tenant_id=me_response.tenant_id,
        tenant_name=me_response.tenant_name,
        feature_flags=me_response.feature_flags,
    )

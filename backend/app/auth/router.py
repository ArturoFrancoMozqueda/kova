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
from app.db import get_db
from app.middleware.csrf import clear_csrf_cookie, set_csrf_cookie
from app.middleware.rate_limit import rate_limit
from app.shared.dependencies import get_current_session

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


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
    "/signup", status_code=201, response_model=SignupResponse,
    dependencies=[Depends(rate_limit(10, key="auth-signup"))],
)
def signup(body: SignupRequest, request: Request, db: Session = Depends(get_db)):
    user, tenant_id, token = service.signup(
        db,
        email=body.email,
        password=body.password,
        tenant_name=body.tenant_name,
        ip_address=request.client.host if request.client else None,
    )
    dev_token = token if settings.app_env == "local" else None
    return SignupResponse(
        message="Account created. Verify your email to log in.",
        user_id=user.id,
        tenant_id=tenant_id,
        dev_verification_token=dev_token,
    )


@router.post("/verify", response_model=MessageResponse)
def verify_email(body: VerifyEmailRequest, db: Session = Depends(get_db)):
    service.verify_email(db, token=body.token)
    return MessageResponse(message="Email verified.")


@router.post("/login", dependencies=[Depends(rate_limit(20, key="auth-login"))])
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
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
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
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
    dependencies=[Depends(rate_limit(5, key="auth-password-reset"))],
)
def password_reset_request(body: PasswordResetRequestBody, db: Session = Depends(get_db)):
    plain = service.request_password_reset(db, email=body.email)
    dev_token = plain if settings.app_env == "local" else None
    msg = "If that email exists, a reset link has been sent."
    return MessageResponse(message=msg, dev_reset_token=dev_token)


@router.post("/password-reset/confirm", response_model=MessageResponse)
def password_reset_confirm(body: PasswordResetConfirmBody, db: Session = Depends(get_db)):
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
    )

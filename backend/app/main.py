import logging
import sys
from contextlib import contextmanager
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

import app.assistant.events  # noqa: F401
from app.assistant.access import assert_private_policies
from app.assistant.ingest_demand import lifespan as assistant_ingest_lifespan
from app.billing import service as billing_service
from app.config import settings
from app.db import assert_rls_active
from app.middleware.body_size import BodySizeLimitMiddleware
from app.middleware.csrf import csrf_middleware
from app.middleware.security_headers import security_headers_middleware
from app.observability.logging import configure_logging, request_context_middleware
from app.observability.sentry import init_sentry

_DEFAULT_SECRET_KEY = "change-me-in-production-use-a-long-random-string"
_DEFAULT_EMAIL_FROM = "onboarding@resend.dev"


def _is_stripe_test_key(value: str | None) -> bool:
    return bool(value and value.startswith(("sk_test_", "rk_test_")))


def _is_stripe_live_key(value: str | None) -> bool:
    return bool(value and value.startswith(("sk_live_", "rk_live_")))


def _validate_internal_ops_config() -> None:
    emails = settings.internal_admin_email_set
    for entry in emails:
        if "@" not in entry:
            raise RuntimeError(
                "INTERNAL_ADMIN_EMAILS must contain valid email addresses; "
                f"got invalid entry: {entry!r}"
            )

    # Disabled is a safe production state. Once either half is configured,
    # require one exact principal: verified email + immutable user UUID.
    if settings.app_env != "local" and (emails or settings.internal_admin_user_id):
        if len(emails) != 1 or settings.internal_admin_user_id is None:
            raise RuntimeError(
                "Kova Ops access outside local development requires exactly one "
                "INTERNAL_ADMIN_EMAILS entry and INTERNAL_ADMIN_USER_ID"
            )
        root_key = settings.internal_ops_mfa_root_key
        if root_key is None or len(root_key.get_secret_value()) < 32:
            raise RuntimeError(
                "Kova Ops access requires INTERNAL_OPS_MFA_ROOT_KEY with at least 32 characters"
            )
        enrollment_key = settings.internal_ops_mfa_enrollment_key
        if enrollment_key is None or not (
            32 <= len(enrollment_key.get_secret_value()) <= 256
        ):
            raise RuntimeError(
                "Kova Ops access requires INTERNAL_OPS_MFA_ENROLLMENT_KEY "
                "with 32 to 256 characters"
            )
        protected_values = {
            settings.secret_key,
            root_key.get_secret_value(),
            enrollment_key.get_secret_value(),
        }
        if len(protected_values) != 3:
            raise RuntimeError(
                "Kova Ops signing, MFA root, and enrollment keys must be different"
            )


def _validate_config() -> None:
    if settings.app_env != "local" and settings.secret_key == _DEFAULT_SECRET_KEY:
        raise RuntimeError(
            "SECRET_KEY must be changed from the default value in non-local environments"
        )
    # Dev conveniences gated on app_env == "local" (verification/reset tokens
    # returned in responses, /docs open). If live Stripe keys are present the
    # environment is clearly production-grade — refuse to boot in local mode so
    # a misconfigured APP_ENV can never leak account tokens.
    if settings.app_env == "local" and _is_stripe_live_key(settings.stripe_secret_key):
        raise RuntimeError(
            "APP_ENV=local with live Stripe keys is not allowed — set APP_ENV correctly"
        )
    if (
        settings.app_env == "production"
        and _is_stripe_test_key(settings.stripe_secret_key)
        and not settings.stripe_allow_test_mode_in_production
    ):
        raise RuntimeError("STRIPE_SECRET_KEY must use live mode in production")
    # A test-mode webhook signing secret in a live deployment would let Stripe
    # test events verify against production and mutate real subscription state.
    billing_service.validate_webhook_secret_mode()
    if settings.app_env == "production":
        if not settings.app_database_url:
            raise RuntimeError(
                "APP_DATABASE_URL must be set explicitly in production for the RLS runtime role"
            )
        if settings.app_database_url == settings.effective_migration_database_url:
            raise RuntimeError(
                "APP_DATABASE_URL must differ from the privileged migration connection"
            )
        if not settings.resend_api_key:
            raise RuntimeError(
                "RESEND_API_KEY must be set in production — lifecycle emails "
                "(verification, password reset, welcome) cannot be silently skipped"
            )
        if settings.email_from == _DEFAULT_EMAIL_FROM:
            raise RuntimeError(
                "EMAIL_FROM must be configured with a verified domain in production "
                "(default 'onboarding@resend.dev' is not allowed)"
            )
    _validate_internal_ops_config()


@contextmanager
def _startup_phase(phase):
    started = perf_counter()
    try:
        yield
    finally:
        logging.getLogger("app.startup").info(
            "startup_phase phase=%s duration_ms=%.3f", phase, (perf_counter() - started) * 1000
        )


def create_app(*, lazy_routes: bool = False) -> FastAPI:
    with _startup_phase("app.sentry_config"):
        configure_logging()
        init_sentry()
        _validate_config()
    with _startup_phase("app.rls_posture"):
        policy_catalog = assert_rls_active()
    with _startup_phase("app.private_acl"):
        assert_private_policies(policy_catalog=policy_catalog)
    with _startup_phase("app.construction"):
        return _construct_app(lazy_routes=True) if lazy_routes else _construct_app()


def _construct_app(*, lazy_routes: bool = False) -> FastAPI:
    _hide_docs = settings.app_env == "production"
    app = FastAPI(
        lifespan=assistant_ingest_lifespan,
        title="POS API",
        version="0.0.1",
        docs_url=None if _hide_docs else "/docs",
        redoc_url=None if _hide_docs else "/redoc",
        openapi_url=None if _hide_docs else "/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_url],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=[
            "Content-Type",
            "Idempotency-Key",
            "X-Internal-Key",
            "X-CSRF-Token",
            "X-Kova-Client-Id",
            "X-Kova-Anonymous-Token",
            "X-Kova-Expected-Tenant",
            "X-Kova-Expected-User",
            "X-Kova-Branch",
        ],
        expose_headers=["X-Kova-Identity-Mismatch"],
    )
    # Report payloads (business-story) are large JSON; compress anything over
    # 1 KB when the client negotiates it. Registered before the http
    # middlewares so it runs innermost: it compresses the route response while
    # body-size/csrf/security-headers keep their existing (outer) ordering.
    # Workers' ASGI response adapter uses automatic Fetch body encoding. Sending
    # already-gzipped bytes through it compresses the payload twice. Let the
    # Cloudflare edge negotiate compression; native HTTP servers retain gzip.
    if sys.platform != "emscripten":
        app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.middleware("http")(security_headers_middleware)
    app.middleware("http")(csrf_middleware)
    app.middleware("http")(request_context_middleware)
    # Added last → runs outermost: reject oversized bodies before any other work.
    app.add_middleware(BodySizeLimitMiddleware)

    _error_logger = logging.getLogger("app.errors")

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # FastAPI's default response echoes `input` (including entire bodies
        # for model errors) and validator context. Preserve the documented
        # loc/msg/type contract without reflecting passwords, tokens, provider
        # keys, or customer data into response logs and error reporting.
        errors = [
            {"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.exception_handler(SQLAlchemyError)
    async def _sqlalchemy_exception_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        _error_logger.exception(
            "database_error", extra={"path": request.url.path, "method": request.method}
        )
        return JSONResponse(status_code=500, content={"detail": "Database error"})

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        _error_logger.exception(
            "unhandled_error", extra={"path": request.url.path, "method": request.method}
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    if not lazy_routes:
        from app.route_registry import include_routes

        include_routes(app)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"app": "pos-backend", "env": settings.app_env}

    return app


# Workers bootstrap builds its application after invocation-bound configuration.
# Native servers retain the complete application and OpenAPI contract.
app = None if sys.platform == "emscripten" else create_app()


def create_worker_app():
    if settings.app_env != "production":
        return create_app()
    from app.route_registry import LazyRoutes

    return LazyRoutes(create_app(lazy_routes=True))

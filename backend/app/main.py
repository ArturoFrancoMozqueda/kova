import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.account_lifecycle.router import router as account_lifecycle_router
from app.auth.router import router as auth_router
from app.billing import service as billing_service
from app.billing.router import router as billing_router
from app.business_settings.logo_router import router as business_settings_logo_router
from app.business_settings.router import router as business_settings_router
from app.catalog.image_router import router as catalog_image_router
from app.catalog.router import router as catalog_router
from app.config import settings
from app.db import assert_rls_active
from app.employees.router import router as employees_router
from app.expenses.router import router as expenses_router
from app.health.router import router as health_router
from app.imports.router import router as imports_router
from app.inventory.router import router as inventory_router
from app.middleware.body_size import body_size_limit_middleware
from app.middleware.csrf import csrf_middleware
from app.middleware.security_headers import security_headers_middleware
from app.modifiers.router import router as modifiers_router
from app.observability.logging import configure_logging, request_context_middleware
from app.observability.sentry import init_sentry
from app.onboarding.router import router as onboarding_router
from app.orders.router import router as orders_router
from app.reports.router import router as reports_router
from app.shifts.router import router as shifts_router
from app.sync.router import router as sync_router
from app.telemetry.router import router as telemetry_router

_DEFAULT_SECRET_KEY = "change-me-in-production-use-a-long-random-string"
_DEFAULT_EMAIL_FROM = "onboarding@resend.dev"


def _is_stripe_test_key(value: str | None) -> bool:
    return bool(value and value.startswith(("sk_test_", "rk_test_")))


def _is_stripe_live_key(value: str | None) -> bool:
    return bool(value and value.startswith(("sk_live_", "rk_live_")))


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


def create_app() -> FastAPI:
    configure_logging()
    init_sentry()
    _validate_config()
    assert_rls_active()
    _hide_docs = settings.app_env == "production"
    app = FastAPI(
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
        ],
    )
    # Report payloads (business-story) are large JSON; compress anything over
    # 1 KB when the client negotiates it. Registered before the http
    # middlewares so it runs innermost: it compresses the route response while
    # body-size/csrf/security-headers keep their existing (outer) ordering.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.middleware("http")(security_headers_middleware)
    app.middleware("http")(csrf_middleware)
    app.middleware("http")(request_context_middleware)
    # Added last → runs outermost: reject oversized bodies before any other work.
    app.middleware("http")(body_size_limit_middleware)

    _error_logger = logging.getLogger("app.errors")

    @app.exception_handler(SQLAlchemyError)
    async def _sqlalchemy_exception_handler(
        request: Request, exc: SQLAlchemyError
    ) -> JSONResponse:
        _error_logger.exception(
            "database_error", extra={"path": request.url.path, "method": request.method}
        )
        return JSONResponse(status_code=500, content={"detail": "Database error"})

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        _error_logger.exception(
            "unhandled_error", extra={"path": request.url.path, "method": request.method}
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(health_router)
    app.include_router(account_lifecycle_router)
    app.include_router(auth_router)
    app.include_router(billing_router)
    app.include_router(business_settings_router)
    app.include_router(business_settings_logo_router)
    app.include_router(catalog_router)
    app.include_router(catalog_image_router)
    app.include_router(employees_router)
    app.include_router(expenses_router)
    app.include_router(modifiers_router)
    app.include_router(inventory_router)
    app.include_router(imports_router)
    app.include_router(onboarding_router)
    app.include_router(orders_router)
    app.include_router(reports_router)
    app.include_router(shifts_router)
    app.include_router(sync_router)
    app.include_router(telemetry_router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"app": "pos-backend", "env": settings.app_env}

    return app


app = create_app()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.billing.router import router as billing_router
from app.business_settings.logo_router import router as business_settings_logo_router
from app.business_settings.router import router as business_settings_router
from app.catalog.router import router as catalog_router
from app.config import settings
from app.employees.router import router as employees_router
from app.health.router import router as health_router
from app.inventory.router import router as inventory_router
from app.middleware.security_headers import security_headers_middleware
from app.modifiers.router import router as modifiers_router
from app.observability.logging import configure_logging, request_context_middleware
from app.observability.sentry import init_sentry
from app.onboarding.router import router as onboarding_router
from app.orders.router import router as orders_router
from app.reports.router import router as reports_router
from app.shifts.router import router as shifts_router
from app.sync.router import router as sync_router

_DEFAULT_SECRET_KEY = "change-me-in-production-use-a-long-random-string"


def _is_stripe_test_key(value: str | None) -> bool:
    return bool(value and value.startswith(("sk_test_", "rk_test_")))


def _validate_config() -> None:
    if settings.app_env != "local" and settings.secret_key == _DEFAULT_SECRET_KEY:
        raise RuntimeError(
            "SECRET_KEY must be changed from the default value in non-local environments"
        )
    if (
        settings.app_env == "production"
        and _is_stripe_test_key(settings.stripe_secret_key)
        and not settings.stripe_allow_test_mode_in_production
    ):
        raise RuntimeError("STRIPE_SECRET_KEY must use live mode in production")


def create_app() -> FastAPI:
    configure_logging()
    init_sentry()
    _validate_config()
    app = FastAPI(title="POS API", version="0.0.1")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_url],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Idempotency-Key", "X-Internal-Key"],
    )
    app.middleware("http")(security_headers_middleware)
    app.middleware("http")(request_context_middleware)

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(billing_router)
    app.include_router(business_settings_router)
    app.include_router(business_settings_logo_router)
    app.include_router(catalog_router)
    app.include_router(employees_router)
    app.include_router(modifiers_router)
    app.include_router(inventory_router)
    app.include_router(onboarding_router)
    app.include_router(orders_router)
    app.include_router(reports_router)
    app.include_router(shifts_router)
    app.include_router(sync_router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"app": "pos-backend", "env": settings.app_env}

    return app


app = create_app()

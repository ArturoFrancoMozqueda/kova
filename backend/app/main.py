from fastapi import FastAPI

from app.auth.router import router as auth_router
from app.catalog.router import router as catalog_router
from app.config import settings
from app.health.router import router as health_router
from app.observability.logging import configure_logging, request_context_middleware
from app.observability.sentry import init_sentry
from app.orders.router import router as orders_router


def create_app() -> FastAPI:
    configure_logging()
    init_sentry()
    app = FastAPI(title="POS API", version="0.0.1")
    app.middleware("http")(request_context_middleware)

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(catalog_router)
    app.include_router(orders_router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"app": "pos-backend", "env": settings.app_env}

    return app


app = create_app()

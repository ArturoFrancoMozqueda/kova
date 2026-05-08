from fastapi import FastAPI

from app.config import settings
from app.health.router import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="POS API", version="0.0.1")
    app.include_router(health_router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"app": "pos-backend", "env": settings.app_env}

    return app


app = create_app()

import os

# Force dev mode before any app module is imported so Settings() picks it up.
os.environ["APP_ENV"] = "local"

import subprocess

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Import all models so Base.metadata is fully populated before migrations check
import app.audit.models  # noqa: F401
import app.auth.models  # noqa: F401
import app.billing.models  # noqa: F401
import app.business_settings.models  # noqa: F401
import app.catalog.models  # noqa: F401
import app.employees.models  # noqa: F401
import app.idempotency.models  # noqa: F401
import app.inventory  # noqa: F401
import app.modifiers.models  # noqa: F401
import app.onboarding.models  # noqa: F401
import app.orders.models  # noqa: F401
import app.rbac.models  # noqa: F401
import app.reports  # noqa: F401
import app.shifts.models  # noqa: F401
import app.tenants.models  # noqa: F401
from app.config import settings
from app.db import get_db
from app.main import app as fastapi_app

_engine = create_engine(settings.database_url, pool_pre_ping=True)
_TestSession = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    subprocess.run(["alembic", "upgrade", "head"], check=True, cwd=".")


@pytest.fixture
def db(apply_migrations):  # noqa: ARG001
    connection = _engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")

    def override_get_db():
        yield session

    fastapi_app.dependency_overrides[get_db] = override_get_db
    yield session
    fastapi_app.dependency_overrides.clear()
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db):
    return TestClient(fastapi_app, raise_server_exceptions=True)

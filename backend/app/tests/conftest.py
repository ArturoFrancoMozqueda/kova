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
import app.ops.models  # noqa: F401
import app.orders.models  # noqa: F401
import app.rbac.models  # noqa: F401
import app.reports  # noqa: F401
import app.shifts.models  # noqa: F401
import app.telemetry.models  # noqa: F401
import app.tenants.models  # noqa: F401
from app.config import settings
from app.db import get_db
from app.main import app as fastapi_app

_engine = create_engine(settings.database_url, pool_pre_ping=True)
_TestSession = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


def _install_auto_csrf(test_client: TestClient) -> TestClient:
    """Echo the CSRF cookie for normal test clients."""
    if getattr(test_client, "_auto_csrf_installed", False):
        return test_client

    original_request = test_client.request
    unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}

    def request_with_csrf(method, url, **kwargs):
        if not getattr(test_client, "_disable_auto_csrf", False):
            if method.upper() in unsafe_methods:
                token = test_client.cookies.get("csrf_token")
                if token:
                    headers = dict(kwargs.get("headers") or {})
                    if not any(k.lower() == "x-csrf-token" for k in headers):
                        headers["x-csrf-token"] = token
                    kwargs["headers"] = headers
        return original_request(method, url, **kwargs)

    test_client.request = request_with_csrf  # type: ignore[method-assign]
    test_client._auto_csrf_installed = True
    return test_client


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


@pytest.fixture(autouse=True)
def _clear_ops_cache():
    """The ops connector cache is a process-wide singleton; clear it between
    tests so a cached (e.g. not_configured) result can't leak across cases."""
    from app.ops.cache import ops_cache

    ops_cache.clear()
    yield
    ops_cache.clear()


@pytest.fixture(autouse=True)
def auto_csrf_for_test_clients(monkeypatch):
    """Make ad-hoc TestClient(app) instances behave like the shared fixture."""
    original_init = TestClient.__init__

    def init_with_auto_csrf(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        _install_auto_csrf(self)

    monkeypatch.setattr(TestClient, "__init__", init_with_auto_csrf)


@pytest.fixture
def client(db):
    test_client = TestClient(fastapi_app, raise_server_exceptions=True)

    # Auto-echo the CSRF cookie into the X-CSRF-Token header for state-changing
    # requests. Real browsers don't do this — our SPA wires it explicitly — but
    # in tests we want existing POST/PUT/PATCH/DELETE specs to keep working
    # without rewriting every call site. Negative CSRF tests construct their
    # own TestClient or pass `headers={"x-csrf-token": "..."}` explicitly to
    # override.
    original_request = test_client.request
    unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}

    def request_with_csrf(method, url, **kwargs):
        if method.upper() in unsafe_methods:
            token = test_client.cookies.get("csrf_token")
            if token:
                headers = dict(kwargs.get("headers") or {})
                if not any(k.lower() == "x-csrf-token" for k in headers):
                    headers["x-csrf-token"] = token
                kwargs["headers"] = headers
        return original_request(method, url, **kwargs)

    test_client.request = request_with_csrf  # type: ignore[method-assign]
    return test_client

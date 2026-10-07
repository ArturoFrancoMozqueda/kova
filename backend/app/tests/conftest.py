import os

# Force dev mode before any app module is imported so Settings() picks it up.
os.environ["APP_ENV"] = "local"
os.environ["INTERNAL_ADMIN_EMAILS"] = ""
os.environ["INTERNAL_OPS_MFA_ROOT_KEY"] = "test-only-kova-ops-mfa-root-key-32-bytes-minimum"
os.environ["INTERNAL_OPS_MFA_ENROLLMENT_KEY"] = (
    "test-only-kova-ops-enrollment-key-32-bytes-minimum"
)

import subprocess

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

# Import all models so Base.metadata is fully populated before migrations check
import app.account_lifecycle.models  # noqa: F401
import app.audit.models  # noqa: F401
import app.auth.models  # noqa: F401
import app.billing.models  # noqa: F401
import app.branches.models  # noqa: F401
import app.branches.transfers  # noqa: F401
import app.business_settings.models  # noqa: F401
import app.catalog.models  # noqa: F401
import app.cfdi.models  # noqa: F401
import app.customer_orders.models  # noqa: F401
import app.customers.models  # noqa: F401
import app.employees.models  # noqa: F401
import app.expenses.models  # noqa: F401
import app.idempotency.models  # noqa: F401
import app.integrations.models  # noqa: F401
import app.inventory  # noqa: F401
import app.modifiers.models  # noqa: F401
import app.onboarding.models  # noqa: F401
import app.ops.models  # noqa: F401
import app.orders.models  # noqa: F401
import app.purchasing.models  # noqa: F401
import app.rbac.models  # noqa: F401
import app.reports  # noqa: F401
import app.shifts.models  # noqa: F401
import app.telemetry.models  # noqa: F401
import app.tenants.models  # noqa: F401
from app.config import settings
from app.db import get_db, get_privileged_db
from app.main import app as fastapi_app

_engine = create_engine(settings.database_url, pool_pre_ping=True)
_TestSession = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


@pytest.fixture
def fast_business_auth(monkeypatch, request):
    """Opt-in password cost reduction, with real hashing and real auth routes.

    Only business modules request this fixture. Auth/security suites retain
    production cost and the timing-equalization hash. Monkeypatch restores both
    after every test; sessions, CSRF, permissions and RLS are untouched.
    """
    from app.auth import service

    protected = ("test_auth", "test_security", "test_csrf", "test_hardening",
                 "test_rate_limit", "test_ops_auth", "test_ops_mfa")
    if request.path.name.startswith(protected):
        raise RuntimeError("auth/security tests must use production bcrypt cost")
    monkeypatch.setattr(service, "_BCRYPT_ROUNDS", 4)
    monkeypatch.setattr(service, "_DUMMY_PASSWORD_HASH",
                        service.hash_password("timing-equalizer-not-a-real-password"))


def _install_auto_csrf(test_client: TestClient) -> TestClient:
    """Echo the CSRF cookie for normal test clients."""
    if getattr(test_client, "_auto_csrf_installed", False):
        return test_client

    original_request = test_client.request
    unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}

    def request_with_csrf(method, url, **kwargs):
        if not getattr(test_client, "_disable_auto_csrf", False):
            if method.upper() in unsafe_methods:
                headers = dict(kwargs.get("headers") or {})
                token = test_client.cookies.get("csrf_token")
                if token and not any(k.lower() == "x-csrf-token" for k in headers):
                    headers["x-csrf-token"] = token
                # See the `client` fixture: browsers always send Origin on
                # state-changing requests, and public endpoints now check it.
                if not any(k.lower() == "origin" for k in headers):
                    headers["origin"] = settings.frontend_url
                kwargs["headers"] = headers
        return original_request(method, url, **kwargs)

    test_client.request = request_with_csrf  # type: ignore[method-assign]
    test_client._auto_csrf_installed = True
    return test_client


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    subprocess.run(["alembic", "upgrade", "head"], check=True, cwd=".")


# Dev/CI-only password for the least-privilege role used by the RLS test. The
# real password is injected via secret in staging/prod (see provision_app_role.sql).
_KOVA_APP_PASSWORD = "kova_app"


def _provision_kova_app() -> None:
    """Create/refresh the non-owner `kova_app` role and its grants against the
    test database, mirroring backend/scripts/provision_app_role.sql. Kept as
    inline SQL here because the .sql file uses psql meta-commands (\\if, \\set)
    that a raw driver can't run."""
    db_name = make_url(settings.database_url).database
    with _engine.begin() as conn:
        conn.execute(
            text(
                "DO $$ BEGIN "
                "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN "
                "CREATE ROLE kova_app LOGIN NOSUPERUSER NOBYPASSRLS "
                "NOCREATEDB NOCREATEROLE; END IF; END $$;"
            )
        )
        conn.execute(text(f"ALTER ROLE kova_app WITH PASSWORD '{_KOVA_APP_PASSWORD}'"))
        conn.execute(text(f'GRANT CONNECT ON DATABASE "{db_name}" TO kova_app'))
        conn.execute(text("GRANT USAGE ON SCHEMA public,extensions,assistant_control TO kova_app"))
        conn.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA assistant_control TO kova_app"))
        conn.execute(text("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kova_app"))
        conn.execute(text("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kova_app"))
        conn.execute(text("GRANT SELECT, INSERT ON branches TO kova_app"))
        conn.execute(text("GRANT UPDATE (name, address) ON branches TO kova_app"))
        grants = {
            "SELECT, INSERT, UPDATE, DELETE": (
                "expenses product_image_files tenant_logo_files assistant_records assistant_chunks"
            ),
            "SELECT, INSERT, DELETE": (
                "customer_order_item_modifiers customer_order_items "
                "product_modifier_groups"
            ),
            "SELECT, INSERT, UPDATE": (
                "account_deletion_requests categories customer_orders customers idempotency_keys "
                "inventory_reservations membership_invitations modifier_groups "
                "modifier_options orders products shifts subscriptions "
                "tenant_business_profiles tenant_onboarding_state tenant_receipt_settings"
            ),
            "SELECT, UPDATE": (
                "memberships sessions"
            ),
            "SELECT, INSERT": (
                "cash_movements inventory_movements inventory_transfers suppliers purchase_orders "
                "purchase_order_items fiscal_issuer_profiles invoice_requests "
                "cfdi_connections cfdi_documents "
                "order_item_modifiers order_items payments "
                "refund_items refunds voids order_fiscal_snapshots "
                "order_item_fiscal_snapshots order_item_tax_snapshots "
                "fiscal_global_draft_batches fiscal_global_draft_orders "
                "fiscal_individual_invoice_events fiscal_global_draft_adjustments"
            ),
            "INSERT": ("audit_logs telemetry_events"),
        }
        for privileges, table_names in grants.items():
            conn.execute(
                text(
                    f"GRANT {privileges} ON TABLE "
                    + ", ".join(table_names.split())
                    + " TO kova_app"
                )
            )
        conn.execute(
            text("GRANT SELECT, INSERT, UPDATE ON fiscal_global_draft_settings TO kova_app")
        )
        conn.execute(text("GRANT UPDATE (status) ON purchase_orders TO kova_app"))
        conn.execute(text("GRANT UPDATE (received_quantity) ON purchase_order_items TO kova_app"))
        conn.execute(text("GRANT UPDATE (fiscal_data) ON fiscal_issuer_profiles TO kova_app"))
        conn.execute(text(
            "GRANT UPDATE (organization_id, encrypted_api_key, issuer_rfc, production_ready, "
            "certificate_expires_at, refreshed_at) ON cfdi_connections TO kova_app"
        ))
        conn.execute(text(
            "GRANT UPDATE (state, provider_id, uuid, xml_bytes, last_error_code, cancellation_status, "
            "cancellation_key, cancellation_hash, cancellation_payload, confirmed_at, canceled_at, "
            "updated_at) ON cfdi_documents TO kova_app"
        ))
        conn.execute(text("GRANT INSERT ON anonymous_telemetry_events TO kova_app"))
        conn.execute(text("GRANT SELECT ON tenants TO kova_app"))
        conn.execute(text("GRANT UPDATE (name, updated_at) ON tenants TO kova_app"))
        conn.execute(text("GRANT SELECT ON users TO kova_app"))
        conn.execute(text("GRANT UPDATE (id) ON TABLE order_fiscal_snapshots TO kova_app"))
        conn.execute(
            text("GRANT UPDATE (id) ON TABLE fiscal_global_draft_batches TO kova_app")
        )


@pytest.fixture(scope="session")
def owner_engine(apply_migrations):  # noqa: ARG001
    """Owner/superuser engine — seeds and cleans up committed rows for the RLS
    test (bypasses RLS, like migrations and the privileged runtime engine)."""
    return _engine


@pytest.fixture(scope="session")
def kova_app_engine(apply_migrations):  # noqa: ARG001
    """Least-privilege, non-owner engine subject to RLS. This is the only way to
    prove tenant_isolation actually blocks at the SQL layer — the app's own test
    connection runs as the owner (transactional-isolation fixture), so it can't."""
    _provision_kova_app()
    url = make_url(settings.database_url).set(
        username="kova_app", password=_KOVA_APP_PASSWORD
    )
    app_engine = create_engine(url, poolclass=NullPool, future=True)
    yield app_engine
    app_engine.dispose()


@pytest.fixture
def db(apply_migrations):  # noqa: ARG001
    connection = _engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")

    def override_get_db():
        try:
            yield session
        finally:
            # The production dependency closes its request-local session.
            # Tests reuse one transaction, so discard the request branch too.
            session.info.pop("kova_branch_id", None)
            session.info.pop("kova_allowed_branch_id", None)

    # Route BOTH the normal and the privileged dependency to the single
    # transactional session. In production get_privileged_db opens a separate
    # (RLS-bypassing) connection, but in tests a second real connection would sit
    # outside this transaction and deadlock against the row locks it holds
    # (e.g. login's SELECT ... FOR UPDATE). One session keeps tests isolated and
    # lock-free; RLS bypass itself is proven separately in test_rls_enforcement.py.
    fastapi_app.dependency_overrides[get_db] = override_get_db
    fastapi_app.dependency_overrides[get_privileged_db] = override_get_db
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
            headers = dict(kwargs.get("headers") or {})
            token = test_client.cookies.get("csrf_token")
            if token and not any(k.lower() == "x-csrf-token" for k in headers):
                headers["x-csrf-token"] = token
            # Browsers attach Origin to every state-changing request; TestClient
            # does not. Public endpoints now verify it (see
            # app.shared.origin.require_trusted_origin), so mirror the browser
            # here rather than making every existing spec set it by hand.
            # Negative tests override by passing `origin` explicitly.
            if not any(k.lower() == "origin" for k in headers):
                headers["origin"] = settings.frontend_url
            kwargs["headers"] = headers
        return original_request(method, url, **kwargs)

    test_client.request = request_with_csrf  # type: ignore[method-assign]
    return test_client

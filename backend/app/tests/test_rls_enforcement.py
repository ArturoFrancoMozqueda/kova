"""Real RLS enforcement test (PLAN-02).

Unlike the rest of the suite — which runs over the owner connection and therefore
only proves the application-layer tenant filter — this test connects as the
non-owner `kova_app` role, so Postgres RLS actually applies. It fails if the
FORCE migration (0036) or the role split is reverted, which is the whole point:
it guards the SQL-layer guarantee, not just the app-layer one.
"""

import uuid

import pytest
from sqlalchemy import text

TENANT_A = uuid.UUID("11111111-1111-1111-1111-1111111111a1")
TENANT_B = uuid.UUID("22222222-2222-2222-2222-2222222222b2")
PRODUCT_A = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1")
PRODUCT_B = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2")


@pytest.fixture
def rls_seed(owner_engine):
    """Commit two tenants + a product each (as owner, RLS-bypassing), then remove
    them afterwards. Committed — not transactional — so a separate kova_app
    connection can see them."""
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tenants (id, name, slug) VALUES "
                "(:a, 'RLS A', :sa), (:b, 'RLS B', :sb)"
            ),
            {"a": TENANT_A, "b": TENANT_B, "sa": f"rls-{TENANT_A}", "sb": f"rls-{TENANT_B}"},
        )
        conn.execute(
            text(
                "INSERT INTO products (id, tenant_id, name, price_amount) VALUES "
                "(:pa, :a, 'Prod A', 10.00), (:pb, :b, 'Prod B', 20.00)"
            ),
            {"pa": PRODUCT_A, "pb": PRODUCT_B, "a": TENANT_A, "b": TENANT_B},
        )
    try:
        yield
    finally:
        with owner_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM products WHERE id IN (:pa, :pb)"),
                {"pa": PRODUCT_A, "pb": PRODUCT_B},
            )
            conn.execute(
                text("DELETE FROM tenants WHERE id IN (:a, :b)"),
                {"a": TENANT_A, "b": TENANT_B},
            )


def _set_tenant(conn, tenant_id):
    conn.execute(
        text("SELECT set_config('app.tenant_id', :tid, false)"),
        {"tid": str(tenant_id)},
    )


def test_cross_tenant_read_is_blocked(kova_app_engine, rls_seed):  # noqa: ARG001
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        names = {
            row[0]
            for row in conn.execute(
                text("SELECT name FROM products WHERE id IN (:pa, :pb)"),
                {"pa": PRODUCT_A, "pb": PRODUCT_B},
            )
        }
    assert names == {"Prod A"}, f"tenant A must only see its own product, saw {names}"


def test_no_context_sees_nothing(kova_app_engine, rls_seed):  # noqa: ARG001
    # With no app.tenant_id set, the qual compares against NULL → deny by default.
    with kova_app_engine.connect() as conn:
        count = conn.execute(
            text("SELECT count(*) FROM products WHERE id IN (:pa, :pb)"),
            {"pa": PRODUCT_A, "pb": PRODUCT_B},
        ).scalar()
    assert count == 0


def test_cross_tenant_insert_is_rejected(kova_app_engine, rls_seed):  # noqa: ARG001
    from sqlalchemy.exc import DBAPIError

    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "INSERT INTO products (tenant_id, name, price_amount) "
                    "VALUES (:b, 'Evil', 1.00)"
                ),
                {"b": TENANT_B},
            )
        assert "row-level security" in str(exc.value).lower()


def test_cross_tenant_update_is_rejected(kova_app_engine, rls_seed):  # noqa: ARG001
    from sqlalchemy.exc import DBAPIError

    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        # Try to move tenant A's own product into tenant B — WITH CHECK must reject.
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text("UPDATE products SET tenant_id = :b WHERE id = :pa"),
                {"b": TENANT_B, "pa": PRODUCT_A},
            )
        assert "row-level security" in str(exc.value).lower()

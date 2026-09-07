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
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.business_settings import service as business_settings_service
from app.business_settings.schemas import BusinessProfileUpsert, ReceiptSettingsUpsert
from app.db import set_tenant_context
from app.sync.schemas import OfflineSaleSyncItem
from app.sync.service import sync_offline_sales

TENANT_A = uuid.UUID("11111111-1111-1111-1111-1111111111a1")
TENANT_B = uuid.UUID("22222222-2222-2222-2222-2222222222b2")
PRODUCT_A = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1")
PRODUCT_B = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2")
USER_A = uuid.UUID("33333333-3333-3333-3333-3333333333a3")
USER_B = uuid.UUID("44444444-4444-4444-4444-4444444444b4")
SUBSCRIPTION_A = uuid.UUID("55555555-5555-5555-5555-5555555555a5")
SUBSCRIPTION_B = uuid.UUID("66666666-6666-6666-6666-6666666666b6")
EXPENSE_A = uuid.UUID("77777777-7777-7777-7777-7777777777a7")
EXPENSE_B = uuid.UUID("88888888-8888-8888-8888-8888888888b8")
DELETION_A = uuid.UUID("99999999-9999-9999-9999-9999999999a9")
DELETION_B = uuid.UUID("99999999-9999-9999-9999-9999999999b9")
TELEMETRY_A = uuid.UUID("aaaaaaaa-1111-1111-1111-1111111111a1")
TELEMETRY_B = uuid.UUID("bbbbbbbb-2222-2222-2222-2222222222b2")
CUSTOMER_ORDER_A = uuid.UUID("cccccccc-1111-1111-1111-1111111111a1")
CUSTOMER_ORDER_B = uuid.UUID("dddddddd-2222-2222-2222-2222222222b2")


@pytest.fixture
def rls_seed(owner_engine):
    """Commit two tenants + a product each (as owner, RLS-bypassing), then remove
    them afterwards. Committed — not transactional — so a separate kova_app
    connection can see them."""
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tenants (id, name, slug) VALUES (:a, 'RLS A', :sa), (:b, 'RLS B', :sb)"
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
        conn.execute(
            text(
                "INSERT INTO customer_orders "
                "(id, tenant_id, folio, status, fulfillment_type, source_channel, "
                "subtotal_amount, total_amount, version, created_at, updated_at) VALUES "
                "(:oa, :a, 'PED-RLS0001', 'new', 'pickup', 'counter', 10, 10, 1, now(), now()), "
                "(:ob, :b, 'PED-RLS0002', 'new', 'pickup', 'counter', 20, 20, 1, now(), now())"
            ),
            {
                "oa": CUSTOMER_ORDER_A,
                "ob": CUSTOMER_ORDER_B,
                "a": TENANT_A,
                "b": TENANT_B,
            },
        )
        conn.execute(
            text(
                "INSERT INTO tenant_receipt_settings "
                "(tenant_id, receipt_business_name) VALUES "
                "(:a, 'Receipt A'), (:b, 'Receipt B')"
            ),
            {"a": TENANT_A, "b": TENANT_B},
        )
        conn.execute(
            text(
                "INSERT INTO fiscal_global_draft_settings "
                "(tenant_id, frequency, weekly_close_day, monthly_close_day, "
                "auto_close_enabled, created_at, updated_at) VALUES "
                "(:a, 'daily', 7, 31, false, now(), now()), "
                "(:b, 'weekly', 7, 31, false, now(), now())"
            ),
            {"a": TENANT_A, "b": TENANT_B},
        )
        conn.execute(
            text(
                "INSERT INTO expenses "
                "(id, tenant_id, category, amount, expense_date, created_at, updated_at) "
                "VALUES (:ea, :a, 'renta', 100.00, CURRENT_DATE, now(), now()), "
                "(:eb, :b, 'servicios', 200.00, CURRENT_DATE, now(), now())"
            ),
            {"ea": EXPENSE_A, "eb": EXPENSE_B, "a": TENANT_A, "b": TENANT_B},
        )
        conn.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, is_email_verified) VALUES "
                "(:ua, 'rls-a@example.com', 'hash-a', true), "
                "(:ub, 'rls-b@example.com', 'hash-b', true)"
            ),
            {"ua": USER_A, "ub": USER_B},
        )
        conn.execute(
            text(
                "INSERT INTO memberships (tenant_id, user_id, role) VALUES "
                "(:a, :ua, 'owner'), (:b, :ub, 'owner')"
            ),
            {"a": TENANT_A, "b": TENANT_B, "ua": USER_A, "ub": USER_B},
        )
        conn.execute(
            text(
                "INSERT INTO telemetry_events "
                "(id, tenant_id, user_id, event_name, client_event_id, properties, created_at) "
                "VALUES (:ea, :a, :ua, 'analysis_viewed', 'rls-analysis-a', '{}', now()), "
                "(:eb, :b, :ub, 'analysis_viewed', 'rls-analysis-b', '{}', now())"
            ),
            {
                "ea": TELEMETRY_A,
                "eb": TELEMETRY_B,
                "a": TENANT_A,
                "b": TENANT_B,
                "ua": USER_A,
                "ub": USER_B,
            },
        )
        conn.execute(
            text(
                "INSERT INTO subscriptions (id, tenant_id, stripe_subscription_id, status) "
                "VALUES (:sa, :a, 'sub_rls_a', 'active'), "
                "(:sb, :b, 'sub_rls_b', 'active')"
            ),
            {"sa": SUBSCRIPTION_A, "sb": SUBSCRIPTION_B, "a": TENANT_A, "b": TENANT_B},
        )
        conn.execute(
            text(
                "INSERT INTO account_deletion_requests "
                "(id, tenant_id, status, requested_at, purge_after) VALUES "
                "(:da, :a, 'pending', now(), now() + interval '30 days'), "
                "(:db, :b, 'pending', now(), now() + interval '30 days')"
            ),
            {"da": DELETION_A, "db": DELETION_B, "a": TENANT_A, "b": TENANT_B},
        )
    try:
        yield
    finally:
        with owner_engine.begin() as conn:
            conn.execute(
                text("DELETE FROM customer_orders WHERE id IN (:oa, :ob)"),
                {"oa": CUSTOMER_ORDER_A, "ob": CUSTOMER_ORDER_B},
            )
            conn.execute(
                text("DELETE FROM telemetry_events WHERE id IN (:ea, :eb)"),
                {"ea": TELEMETRY_A, "eb": TELEMETRY_B},
            )
            conn.execute(
                text("DELETE FROM account_deletion_requests WHERE id IN (:da, :db)"),
                {"da": DELETION_A, "db": DELETION_B},
            )
            conn.execute(
                text("DELETE FROM subscriptions WHERE id IN (:sa, :sb)"),
                {"sa": SUBSCRIPTION_A, "sb": SUBSCRIPTION_B},
            )
            conn.execute(
                text("DELETE FROM memberships WHERE user_id IN (:ua, :ub)"),
                {"ua": USER_A, "ub": USER_B},
            )
            conn.execute(
                text("DELETE FROM users WHERE id IN (:ua, :ub)"),
                {"ua": USER_A, "ub": USER_B},
            )
            conn.execute(
                text("DELETE FROM products WHERE id IN (:pa, :pb)"),
                {"pa": PRODUCT_A, "pb": PRODUCT_B},
            )
            conn.execute(
                text("DELETE FROM expenses WHERE id IN (:ea, :eb)"),
                {"ea": EXPENSE_A, "eb": EXPENSE_B},
            )
            conn.execute(
                text("DELETE FROM tenant_receipt_settings WHERE tenant_id IN (:a, :b)"),
                {"a": TENANT_A, "b": TENANT_B},
            )
            conn.execute(
                text("DELETE FROM fiscal_global_draft_settings WHERE tenant_id IN (:a, :b)"),
                {"a": TENANT_A, "b": TENANT_B},
            )
            conn.execute(
                text("DELETE FROM tenant_business_profiles WHERE tenant_id IN (:a, :b)"),
                {"a": TENANT_A, "b": TENANT_B},
            )
            conn.execute(
                text("DELETE FROM audit_logs WHERE tenant_id IN (:a, :b)"),
                {"a": TENANT_A, "b": TENANT_B},
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


def test_session_tenant_context_survives_commit_and_rollback(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with Session(kova_app_engine) as db:
        set_tenant_context(db, TENANT_A)
        for boundary in (db.commit, db.rollback, db.commit):
            ids = set(
                db.execute(
                    text("SELECT id FROM products WHERE id IN (:pa, :pb)"),
                    {"pa": PRODUCT_A, "pb": PRODUCT_B},
                ).scalars()
            )
            assert ids == {PRODUCT_A}
            assert db.execute(
                text("SELECT current_setting('app.tenant_id', true)")
            ).scalar() == str(TENANT_A)
            boundary()


def test_session_recovers_from_invalid_context_without_leaking_between_tenants(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    """A reused runtime session must fail closed and recover after a bad batch item."""
    with Session(kova_app_engine) as db:
        set_tenant_context(db, TENANT_A)
        assert set(
            db.execute(
                text("SELECT id FROM products WHERE id IN (:pa, :pb)"),
                {"pa": PRODUCT_A, "pb": PRODUCT_B},
            ).scalars()
        ) == {PRODUCT_A}
        db.commit()

        set_tenant_context(db, "not-a-tenant-uuid")
        assert (
            db.execute(
                text("SELECT count(*) FROM products WHERE id IN (:pa, :pb)"),
                {"pa": PRODUCT_A, "pb": PRODUCT_B},
            ).scalar()
            == 0
        )
        db.commit()

        set_tenant_context(db, TENANT_B)
        assert set(
            db.execute(
                text("SELECT id FROM products WHERE id IN (:pa, :pb)"),
                {"pa": PRODUCT_A, "pb": PRODUCT_B},
            ).scalars()
        ) == {PRODUCT_B}
        assert db.execute(text("SELECT current_setting('app.tenant_id', true)")).scalar() == str(
            TENANT_B
        )


def test_runtime_offline_batch_restores_rls_context_after_item_rollback(
    kova_app_engine,
    owner_engine,
    rls_seed,  # noqa: ARG001
):
    client_uuids = (uuid.uuid4(), uuid.uuid4(), uuid.uuid4())
    product_ids = (PRODUCT_A, PRODUCT_B, PRODUCT_A)
    sales = [
        OfflineSaleSyncItem.model_validate({
            "client_uuid": client_uuid,
            "order": {
                "items": [{"product_id": product_id, "quantity": 1}],
                "payments": [
                    {"method": "cash", "amount": "10.00", "amount_tendered": "10.00"}
                ],
            },
        })
        for client_uuid, product_id in zip(client_uuids, product_ids, strict=True)
    ]
    order_ids: list[uuid.UUID] = []
    try:
        with Session(kova_app_engine) as db:
            set_tenant_context(db, TENANT_A)
            results = sync_offline_sales(
                db,
                tenant_id=TENANT_A,
                user_id=USER_A,
                sales=sales,
            )
            assert [result.status for result in results] == ["synced", "failed", "synced"], results
            assert "Product not found" in (results[1].error or "")
            order_ids = [result.order_id for result in results if result.order_id is not None]
            assert len(order_ids) == 2
    finally:
        if order_ids:
            params = {"first": order_ids[0], "second": order_ids[1]}
            with owner_engine.begin() as conn:
                immutable_tables = (
                    "order_item_tax_snapshots",
                    "order_item_fiscal_snapshots",
                    "order_fiscal_snapshots",
                )
                for table in immutable_tables:
                    conn.execute(text(f"ALTER TABLE {table} DISABLE TRIGGER trg_{table}_immutable"))
                for table in (
                    *immutable_tables,
                    "payments",
                ):
                    conn.execute(
                        text(f"DELETE FROM {table} WHERE order_id IN (:first, :second)"),
                        params,
                    )
                conn.execute(
                    text(
                        "DELETE FROM order_item_modifiers WHERE order_item_id IN "
                        "(SELECT id FROM order_items WHERE order_id IN (:first, :second))"
                    ),
                    params,
                )
                conn.execute(
                    text("DELETE FROM order_items WHERE order_id IN (:first, :second)"),
                    params,
                )
                conn.execute(
                    text("DELETE FROM orders WHERE id IN (:first, :second)"),
                    params,
                )
                conn.execute(
                    text("DELETE FROM idempotency_keys WHERE key IN (:first_key, :second_key)"),
                    {
                        "first_key": str(client_uuids[0]),
                        "second_key": str(client_uuids[2]),
                    },
                )
                for table in immutable_tables:
                    conn.execute(text(f"ALTER TABLE {table} ENABLE TRIGGER trg_{table}_immutable"))


def test_customer_orders_are_visible_only_to_current_tenant(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        ids = {
            row[0]
            for row in conn.execute(
                text("SELECT id FROM customer_orders WHERE id IN (:oa, :ob)"),
                {"oa": CUSTOMER_ORDER_A, "ob": CUSTOMER_ORDER_B},
            )
        }
    assert ids == {CUSTOMER_ORDER_A}


def test_fiscal_global_settings_are_visible_only_to_current_tenant(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        rows = conn.execute(
            text(
                "SELECT tenant_id, frequency FROM fiscal_global_draft_settings "
                "WHERE tenant_id IN (:a, :b)"
            ),
            {"a": TENANT_A, "b": TENANT_B},
        ).all()
    assert rows == [(TENANT_A, "daily")]


def test_customer_order_cross_tenant_insert_is_rejected(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    from sqlalchemy.exc import DBAPIError

    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "INSERT INTO customer_orders "
                    "(tenant_id, folio, status, fulfillment_type, source_channel, "
                    "subtotal_amount, total_amount, version, created_at, updated_at) "
                    "VALUES (:b, 'PED-EVIL001', 'new', 'pickup', 'counter', 1, 1, 1, now(), now())"
                ),
                {"b": TENANT_B},
            )
        assert "row-level security" in str(exc.value).lower()


def test_expenses_are_visible_only_to_the_current_tenant(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        amounts = {
            row[0]
            for row in conn.execute(
                text("SELECT amount FROM expenses WHERE id IN (:ea, :eb)"),
                {"ea": EXPENSE_A, "eb": EXPENSE_B},
            )
        }
    assert amounts == {100}


def test_telemetry_event_reads_are_reserved_for_privileged_analytics(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text("SELECT id FROM telemetry_events WHERE id IN (:ea, :eb)"),
                {"ea": TELEMETRY_A, "eb": TELEMETRY_B},
            )
        assert exc.value.orig.sqlstate == "42501"


def test_account_deletion_requests_are_tenant_isolated(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        ids = {
            row[0]
            for row in conn.execute(
                text("SELECT id FROM account_deletion_requests WHERE id IN (:da, :db)"),
                {"da": DELETION_A, "db": DELETION_B},
            )
        }
    assert ids == {DELETION_A}


def test_expense_cross_tenant_insert_is_rejected(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    from sqlalchemy.exc import DBAPIError

    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "INSERT INTO expenses "
                    "(tenant_id, category, amount, expense_date, created_at, updated_at) "
                    "VALUES (:b, 'otro', 1.00, CURRENT_DATE, now(), now())"
                ),
                {"b": TENANT_B},
            )
        assert "row-level security" in str(exc.value).lower()


def test_no_context_sees_nothing(kova_app_engine, rls_seed):  # noqa: ARG001
    # With no app.tenant_id set, the qual compares against NULL → deny by default.
    with kova_app_engine.connect() as conn:
        count = conn.execute(
            text("SELECT count(*) FROM products WHERE id IN (:pa, :pb)"),
            {"pa": PRODUCT_A, "pb": PRODUCT_B},
        ).scalar()
    assert count == 0


def test_users_are_visible_only_through_current_tenant_membership(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        emails = {
            row[0]
            for row in conn.execute(
                text("SELECT email FROM users WHERE id IN (:ua, :ub)"),
                {"ua": USER_A, "ub": USER_B},
            )
        }
    assert emails == {"rls-a@example.com"}


def test_tenant_name_is_visible_only_for_current_tenant(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        names = {
            row[0]
            for row in conn.execute(
                text("SELECT name FROM tenants WHERE id IN (:a, :b)"),
                {"a": TENANT_A, "b": TENANT_B},
            )
        }
    assert names == {"RLS A"}


def test_billing_policy_denies_empty_tenant_context_without_uuid_cast_error(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        conn.execute(text("SELECT set_config('app.tenant_id', '', false)"))
        count = conn.execute(
            text("SELECT count(*) FROM subscriptions WHERE id IN (:sa, :sb)"),
            {"sa": SUBSCRIPTION_A, "sb": SUBSCRIPTION_B},
        ).scalar()
    assert count == 0


def test_product_policy_denies_empty_tenant_context_without_uuid_cast_error(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        conn.execute(text("SELECT set_config('app.tenant_id', '', false)"))
        count = conn.execute(
            text("SELECT count(*) FROM products WHERE id IN (:pa, :pb)"),
            {"pa": PRODUCT_A, "pb": PRODUCT_B},
        ).scalar()
    assert count == 0


def test_receipt_policy_denies_empty_tenant_context_without_uuid_cast_error(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        conn.execute(text("SELECT set_config('app.tenant_id', '', false)"))
        count = conn.execute(text("SELECT count(*) FROM tenant_receipt_settings")).scalar()
    assert count == 0


def test_receipt_policy_preserves_tenant_isolation(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        names = {
            row[0]
            for row in conn.execute(
                text("SELECT receipt_business_name FROM tenant_receipt_settings")
            )
        }
    assert names == {"Receipt A"}


def test_receipt_upsert_restores_rls_context_before_post_commit_refresh(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with Session(kova_app_engine) as db:
        _set_tenant(db, TENANT_A)
        settings = business_settings_service.upsert_receipt_settings(
            db,
            tenant_id=TENANT_A,
            user_id=USER_A,
            body=ReceiptSettingsUpsert(receipt_business_name="Receipt A updated"),
        )

        assert settings.tenant_id == TENANT_A
        assert settings.receipt_business_name == "Receipt A updated"


def test_business_profile_can_only_update_the_current_tenant_public_name(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with Session(kova_app_engine) as db:
        set_tenant_context(db, TENANT_A)
        profile = business_settings_service.upsert_business_profile(
            db,
            tenant_id=TENANT_A,
            user_id=USER_A,
            body=BusinessProfileUpsert(public_name="RLS A actualizado"),
        )
        assert profile.public_name == "RLS A actualizado"
        assert db.scalar(text("SELECT name FROM tenants WHERE id = :id"), {"id": TENANT_A}) == (
            "RLS A actualizado"
        )

    from sqlalchemy.exc import DBAPIError

    with kova_app_engine.begin() as conn:
        _set_tenant(conn, TENANT_A)
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text("UPDATE tenants SET is_active = false WHERE id = :id"),
                {"id": TENANT_A},
            )
        assert "permission denied" in str(exc.value).lower()


def test_cross_tenant_insert_is_rejected(kova_app_engine, rls_seed):  # noqa: ARG001
    from sqlalchemy.exc import DBAPIError

    with kova_app_engine.connect() as conn:
        _set_tenant(conn, TENANT_A)
        with pytest.raises(DBAPIError) as exc:
            conn.execute(
                text(
                    "INSERT INTO products (tenant_id, name, price_amount) VALUES (:b, 'Evil', 1.00)"
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


def test_product_delete_is_reserved_for_privileged_purge(
    kova_app_engine,
    rls_seed,  # noqa: ARG001
):
    with kova_app_engine.begin() as conn:
        _set_tenant(conn, TENANT_A)
        with pytest.raises(DBAPIError) as exc:
            conn.execute(text("DELETE FROM products WHERE id = :pb"), {"pb": PRODUCT_B})
        assert exc.value.orig.sqlstate == "42501"

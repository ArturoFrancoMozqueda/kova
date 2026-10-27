"""Old application readers and reversals remain safe with the forward data contract.

Test-only SQL represents the additive 0096–0098 projections. No forward migration
or feature route is shipped by this bridge. DDL rolls back with the test fixture.
"""

import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.account_lifecycle import service as lifecycle
from app.account_lifecycle.models import AccountDeletionRequest
from app.auth.models import User
from app.loyalty.models import LoyaltyEntry
from app.loyalty.rollback_compatibility import guard_reward_reversal
from app.orders.models import Order
from app.tests.test_orders import (
    _create_cash_order,
    _create_product,
    _open_shift,
    _signup_verify_login,
)

pytestmark = pytest.mark.usefixtures("fast_business_auth")


@pytest.fixture
def forward_schema(db):
    # Only schema fields consumed by bridge readers/tooling are represented.
    # Child FKs deliberately enforce the future purge dependency order.
    ddl = """
    CREATE TABLE loyalty_reward_revisions (
      id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), branch_id uuid,
      version integer, enabled boolean, title varchar(160), points_cost bigint,
      discount_amount numeric(12,2), authorized_by_user_id uuid, effective_at timestamptz);
    CREATE TABLE loyalty_reward_redemptions (
      id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), branch_id uuid,
      customer_id uuid REFERENCES customers(id), sale_order_id uuid REFERENCES orders(id),
      reward_revision_id uuid REFERENCES loyalty_reward_revisions(id),
      ledger_entry_id uuid REFERENCES loyalty_entries(id), title varchar(160),
      points_cost bigint, discount_amount numeric(12,2), created_by_user_id uuid,
      created_at timestamptz);
    CREATE TABLE loyalty_enrollment_policies (
      id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), branch_id uuid,
      version integer, enabled boolean, authorized_by_user_id uuid, created_at timestamptz);
    CREATE TABLE loyalty_members (
      id uuid PRIMARY KEY, tenant_id uuid REFERENCES tenants(id), branch_id uuid,
      customer_id uuid REFERENCES customers(id),
      enrollment_policy_id uuid REFERENCES loyalty_enrollment_policies(id),
      code varchar(32), credential_hash varchar(64), bootstrap_hash varchar(64),
      operation_hash varchar(64), request_hash varchar(64), customer_revision varchar(64),
      created_at timestamptz, expires_at timestamptz);
    ALTER TABLE crm_catalog_requests ADD COLUMN order_lines json;
    ALTER TABLE crm_catalog_requests ADD COLUMN origin varchar(16);
    ALTER TABLE crm_catalog_requests ADD COLUMN customer_order_id uuid;
    ALTER TABLE crm_catalog_requests DROP CONSTRAINT ck_catalog_request_status;
    ALTER TABLE crm_catalog_requests ADD CONSTRAINT ck_catalog_request_status
      CHECK(status IN ('new','converted','dismissed','accepted'));
    ALTER TABLE loyalty_entries DROP CONSTRAINT ck_loyalty_entry_kind;
    ALTER TABLE loyalty_entries DROP CONSTRAINT ck_loyalty_entry_sign;
    ALTER TABLE loyalty_entries DROP CONSTRAINT ck_loyalty_entry_source;
    ALTER TABLE loyalty_entries ADD CONSTRAINT ck_loyalty_entry_kind
      CHECK(kind IN ('accrual','refund','void','redemption','reward_return'));
    ALTER TABLE loyalty_entries ADD CONSTRAINT ck_loyalty_entry_sign CHECK(
      (kind='accrual' AND points>=0) OR (kind='reward_return' AND points>0)
      OR (kind IN ('refund','void','redemption') AND points<=0));
    ALTER TABLE loyalty_entries ADD CONSTRAINT ck_loyalty_entry_source CHECK(
      (kind='redemption' AND sale_order_id IS NULL AND policy_revision_id IS NULL
       AND benefit IS NOT NULL AND points<0 AND recorded_by_user_id IS NOT NULL)
      OR (kind='reward_return' AND sale_order_id IS NOT NULL AND policy_revision_id IS NULL
       AND benefit IS NOT NULL AND recorded_by_user_id IS NOT NULL)
      OR (kind IN ('accrual','refund','void') AND sale_order_id IS NOT NULL
       AND policy_revision_id IS NOT NULL AND benefit IS NULL));
    """
    db.execute(text(ddl))
    for table in lifecycle._COMPAT_DELETE_ORDER:
        db.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        db.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
        db.execute(
            text(
                f"CREATE POLICY tenant_isolation ON {table} FOR ALL "
                "USING(tenant_id::text=current_setting('app.tenant_id',true)) "
                "WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true))"
            )
        )
    return db


def sale(client, db, suffix="bridge"):
    identity = _signup_verify_login(client, f"{suffix}@example.com", "Compatibilidad")
    _open_shift(client)
    product = _create_product(client)
    response = _create_cash_order(client, product["id"], str(uuid4()))
    assert response.status_code == 201, response.text
    customer = client.post(
        "/api/v1/customers",
        json={"name": "Cliente compatibilidad"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert customer.status_code == 201
    tenant = UUID(identity["tenant_id"])
    user = db.query(User).filter_by(email=f"{suffix}@example.com").one()
    return tenant, user.id, UUID(customer.json()["id"]), response.json()


def reward(db, tenant, user, customer, order):
    revision, debit, redemption, policy, member = (uuid4() for _ in range(5))
    db.add(
        LoyaltyEntry(
            id=debit,
            tenant_id=tenant,
            branch_id=tenant,
            customer_id=customer,
            kind="redemption",
            source_id=UUID(order["id"]),
            points=-8,
            benefit="Beneficio real",
            recorded_by_user_id=user,
        )
    )
    db.flush()
    db.execute(
        text(
            "INSERT INTO loyalty_reward_revisions VALUES "
            "(:id,:tenant,:tenant,1,true,'Beneficio real',8,25,:user,now())"
        ),
        {"id": revision, "tenant": tenant, "user": user},
    )
    db.execute(
        text(
            "INSERT INTO loyalty_reward_redemptions VALUES "
            "(:id,:tenant,:tenant,:customer,:sale,:revision,:debit,'Beneficio real',"
            "8,25,:user,now())"
        ),
        {
            "id": redemption,
            "tenant": tenant,
            "customer": customer,
            "sale": order["id"],
            "revision": revision,
            "debit": debit,
            "user": user,
        },
    )
    db.execute(
        text(
            "INSERT INTO loyalty_enrollment_policies VALUES "
            "(:id,:tenant,:tenant,1,true,:user,now())"
        ),
        {"id": policy, "tenant": tenant, "user": user},
    )
    db.execute(
        text(
            "INSERT INTO loyalty_members VALUES "
            "(:id,:tenant,:tenant,:customer,:policy,'KV-AAAA-BBBB-CCCC-DDDD',"
            "'private-credential','private-bootstrap','private-operation','private-request',"
            "'private-revision',now(),now()+interval '180 days')"
        ),
        {"id": member, "tenant": tenant, "customer": customer, "policy": policy},
    )
    db.commit()


def test_reward_return_and_accepted_are_readable_without_new_feature_routes(
    client, db, forward_schema
):
    tenant, user, customer, order = sale(client, db)
    db.add(
        LoyaltyEntry(
            tenant_id=tenant,
            branch_id=tenant,
            customer_id=customer,
            kind="reward_return",
            sale_order_id=UUID(order["id"]),
            source_id=UUID(order["id"]),
            points=8,
            benefit="Beneficio real",
            recorded_by_user_id=user,
        )
    )
    db.flush()
    result = client.get(f"/api/v1/loyalty/customers/{customer}")
    assert result.status_code == 200, result.text
    assert result.json()["entries"][0]["kind"] == "reward_return"
    # Projection validation uses the exact reader invoked by GET /crm/requests.
    from app.crm.engagement import request_response
    from app.crm.engagement_models import CatalogRequest

    row = CatalogRequest(
        id=uuid4(),
        name="Persona",
        contact="Contacto",
        message="Pedido",
        product_ids=[],
        status="accepted",
        version=1,
        created_at=datetime.now(UTC),
    )
    assert request_response(row)["status"] == "accepted"
    assert client.get("/api/v1/public/loyalty/membership?menu=none").status_code == 404


@pytest.mark.parametrize("operation", ["refunds", "void"])
def test_reward_sale_reversal_is_blocked_before_money_stock_or_points_change(
    client, db, forward_schema, operation
):
    tenant, user, customer, order = sale(client, db, operation)
    reward(db, tenant, user, customer, order)
    body = (
        {"reason": "operator_error"}
        if operation == "void"
        else {
            "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
            "reason": "customer_return",
            "refund_payment_method": "cash",
        }
    )
    result = client.post(
        f"/api/v1/orders/{order['id']}/{operation}",
        json=body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 409, result.text
    assert "restituir los puntos" in result.json()["detail"]
    assert db.get(Order, UUID(order["id"])).status == "completed"
    for table in ("refunds", "voids"):
        assert (
            db.scalar(
                text(f"SELECT count(*) FROM {table} WHERE order_id=:sale"), {"sale": order["id"]}
            )
            == 0
        )
    assert (
        db.scalar(
            text("SELECT sum(points) FROM loyalty_entries WHERE tenant_id=:tenant"),
            {"tenant": tenant},
        )
        == -8
    )


def test_reversal_replay_still_returns_original_result_and_ordinary_sale_is_supported(
    client, db, forward_schema
):
    tenant, user, customer, order = sale(client, db, "replay")
    body = {
        "items": [{"order_item_id": order["items"][0]["id"], "quantity": 1}],
        "reason": "customer_return",
        "refund_payment_method": "cash",
    }
    headers = {"Idempotency-Key": str(uuid4())}
    first = client.post(f"/api/v1/orders/{order['id']}/refunds", json=body, headers=headers)
    assert first.status_code == 201, first.text
    reward(db, tenant, user, customer, order)
    replay = client.post(f"/api/v1/orders/{order['id']}/refunds", json=body, headers=headers)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert (
        db.scalar(text("SELECT count(*) FROM refunds WHERE order_id=:sale"), {"sale": order["id"]})
        == 1
    )


def test_compatibility_export_and_purge_preserve_private_credentials_and_unknown_graph_guard(
    client, db, forward_schema
):
    tenant, user, customer, order = sale(client, db, "lifecycle")
    reward(db, tenant, user, customer, order)
    archive = lifecycle.build_account_export(db, tenant_id=tenant)
    with zipfile.ZipFile(io.BytesIO(archive.read())) as zip_file:
        manifest = json.loads(zip_file.read("manifest.json"))
        assert all(name in manifest["tables"] for name in lifecycle._COMPAT_DELETE_ORDER)
        members = zip_file.read("datos/loyalty_members.csv").decode()
        assert "KV-AAAA-BBBB-CCCC-DDDD" in members
        assert "private-" not in members and "credential_hash" not in members
        requests = zip_file.read("datos/crm_catalog_requests.csv").decode()
        assert "order_lines" in requests and "customer_order_id" in requests
    request = AccountDeletionRequest(
        tenant_id=tenant,
        requested_by_user_id=user,
        purge_after=datetime.now(UTC) - timedelta(seconds=1),
    )
    db.add(request)
    db.flush()
    db.execute(text("CREATE TABLE unreviewed_tenant_data(tenant_id uuid)"))
    with pytest.raises(RuntimeError, match="ownership graph is incomplete"):
        lifecycle._purge_account_graph(db, request=request, completed_at=datetime.now(UTC))
    assert (
        db.scalar(
            text("SELECT count(*) FROM loyalty_members WHERE tenant_id=:tenant"), {"tenant": tenant}
        )
        == 1
    )
    db.execute(text("DROP TABLE unreviewed_tenant_data"))
    lifecycle._purge_account_graph(db, request=request, completed_at=datetime.now(UTC))
    for table in lifecycle._COMPAT_DELETE_ORDER:
        assert (
            db.scalar(
                text(f"SELECT count(*) FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant}
            )
            == 0
        )


def test_guard_is_scoped_to_tenant_and_branch_and_uses_the_locked_order(client, db, forward_schema):
    from types import SimpleNamespace

    tenant, user, customer, order = sale(client, db, "scope")
    reward(db, tenant, user, customer, order)
    with pytest.raises(HTTPException) as blocked:
        guard_reward_reversal(
            db, tenant_id=tenant, order=SimpleNamespace(id=UUID(order["id"]), branch_id=tenant)
        )
    assert blocked.value.status_code == 409
    guard_reward_reversal(
        db, tenant_id=uuid4(), order=SimpleNamespace(id=UUID(order["id"]), branch_id=tenant)
    )
    guard_reward_reversal(
        db, tenant_id=tenant, order=SimpleNamespace(id=UUID(order["id"]), branch_id=uuid4())
    )
    guard_reward_reversal(db, tenant_id=tenant, order=SimpleNamespace(id=uuid4(), branch_id=tenant))


def test_known_future_grants_stay_append_only_and_metadata_does_not_hide_inaccessible_tables(
    db, forward_schema
):
    import re
    from pathlib import Path

    provision = (Path(__file__).resolve().parents[2] / "scripts/provision_app_role.sql").read_text()
    # Execute only the existing table-grant matrix, never global CREATE/ALTER ROLE.
    matrix = next(
        block
        for block in re.findall(r"DO\s*\$\$.*?\$\$;", provision, re.S)
        if "AS grants(table_name, privilege_list)" in block
    )
    for table in lifecycle._COMPAT_DELETE_ORDER:
        db.execute(text(f"REVOKE ALL ON {table} FROM kova_app"))
    db.execute(text("SET LOCAL ROLE kova_app"))
    assert set(lifecycle._COMPAT_DELETE_ORDER) <= {row.name for row in lifecycle._export_specs(db)}
    db.execute(text("RESET ROLE"))
    db.execute(text(matrix))
    for table in lifecycle._COMPAT_DELETE_ORDER:
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            assert db.scalar(
                text("SELECT has_table_privilege('kova_app',:table,:privilege)"),
                {"table": table, "privilege": privilege},
            ) is (privilege in {"SELECT", "INSERT"})
    tenant, foreign = uuid4(), uuid4()
    db.execute(
        text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Scope',:slug)"),
        {"id": tenant, "slug": str(tenant)},
    )
    db.execute(
        text(
            "INSERT INTO loyalty_reward_revisions(id,tenant_id,branch_id) VALUES(:id,:tenant,:tenant)"
        ),
        {"id": uuid4(), "tenant": tenant},
    )
    db.execute(text("SET LOCAL ROLE kova_app"))
    db.execute(text("SELECT set_config('app.tenant_id',:tenant,true)"), {"tenant": str(foreign)})
    assert db.scalar(text("SELECT count(*) FROM loyalty_reward_revisions")) == 0
    db.execute(text("SELECT set_config('app.tenant_id',:tenant,true)"), {"tenant": str(tenant)})
    assert db.scalar(text("SELECT count(*) FROM loyalty_reward_revisions")) == 1
    db.execute(text("RESET ROLE"))


def test_guard_observes_a_redemption_committed_while_the_order_lock_is_contended():
    """Real PG lock wait, independent database, no global role/password mutations."""
    import time
    from threading import Event, Thread

    import psycopg
    from psycopg import sql
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url
    from sqlalchemy.orm import Session

    from app.config import settings
    from app.orders import repository
    from migration_tests.test_0068_branches import _migrate

    base = make_url(settings.effective_migration_database_url)
    assert base.host in {"127.0.0.1", "localhost"}
    name = "kova_bridge_lock_" + uuid4().hex
    admin_url = base.set(drivername="postgresql", database="postgres").render_as_string(
        hide_password=False
    )
    admin = psycopg.connect(admin_url, autocommit=True)
    engine = None
    thread = None
    try:
        admin.execute(
            sql.SQL("CREATE DATABASE {} TEMPLATE template0 ENCODING 'UTF8'").format(
                sql.Identifier(name)
            )
        )
        target = base.set(database=name).render_as_string(hide_password=False)
        migrated = _migrate(target, "upgrade", "head")
        assert migrated.returncode == 0, migrated.stderr
        engine = create_engine(target)
        tenant, order_id = uuid4(), uuid4()
        with Session(engine) as setup:
            forward_schema.__wrapped__(setup)
            setup.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Lock test',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            setup.execute(
                text(
                    "INSERT INTO orders(id,tenant_id,status,subtotal_amount,total_amount) VALUES(:id,:tenant,'completed',10,10)"
                ),
                {"id": order_id, "tenant": tenant},
            )
            setup.commit()
        started = Event()
        outcome = []
        worker_pid = []

        def worker():
            with Session(engine) as session:
                worker_pid.append(session.scalar(text("SELECT pg_backend_pid()")))
                started.set()
                locked = repository.get_order_for_update(
                    session, tenant_id=tenant, order_id=order_id
                )
                try:
                    guard_reward_reversal(session, tenant_id=tenant, order=locked)
                except HTTPException as failure:
                    outcome.append(failure.status_code)
                finally:
                    session.rollback()

        with engine.connect() as source:
            transaction = source.begin()
            source.execute(text("SELECT id FROM orders WHERE id=:id FOR UPDATE"), {"id": order_id})
            source.execute(
                text(
                    "INSERT INTO loyalty_reward_redemptions(id,tenant_id,branch_id,sale_order_id) VALUES(:id,:tenant,:tenant,:sale)"
                ),
                {"id": uuid4(), "tenant": tenant, "sale": order_id},
            )
            thread = Thread(target=worker)
            thread.start()
            assert started.wait(2)
            deadline = time.monotonic() + 3
            blocked = False
            while time.monotonic() < deadline:
                blocked = bool(
                    admin.execute(
                        "SELECT cardinality(pg_blocking_pids(%s))", (worker_pid[0],)
                    ).fetchone()[0]
                )
                if blocked:
                    break
                time.sleep(0.01)
            assert blocked, "The actual source-order row lock must serialize the reversal"
            transaction.commit()
        thread.join(3)
        assert not thread.is_alive()
        assert outcome == [409]
    finally:
        if thread:
            thread.join(3)
        if engine:
            engine.dispose()
        admin.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
        )
        admin.close()

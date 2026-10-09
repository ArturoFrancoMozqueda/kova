from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth.models import Membership
from app.billing.models import Subscription
from app.db import set_tenant_context
from app.hardware.models import DrawerCommand, DrawerDevice
from app.hardware.service import now
from app.main import app
from app.orders.models import Order
from app.tests.test_orders import _create_product, _open_shift, _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")
BASE = "/api/v1/hardware"


def _setup(client, *, auto=True):
    signup = _signup_verify_login(client, f"drawer-{uuid4().hex}@example.com", "Caja real")
    response = client.post(BASE + "/drawer/setup", json={"name": "Caja 1", "auto_open": auto})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    code = response.json()["pairing_code"]
    with TestClient(app) as bridge:
        paired = bridge.post(BASE + "/connector/pair", json={"code": code})
        assert paired.status_code == 200
        key = paired.json()["device_key"]
        assert bridge.post(BASE + "/connector/pair", json={"code": code}).status_code == 401
        assert (
            bridge.post(BASE + "/connector/poll", headers={"X-Kova-Device-Key": key}).status_code
            == 200
        )
    return signup, code, key


def _sale(client, *, method="cash"):
    product = _create_product(client, price="50.00")
    response = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [
                {
                    "method": method,
                    "amount": "50.00",
                    **({"amount_tendered": "50.00"} if method == "cash" else {}),
                }
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


def _request(client, *, kind="manual", order_id=None, request_id=None):
    return client.post(
        BASE + "/drawer/open",
        json={
            "kind": kind,
            "order_id": order_id,
            "request_id": request_id or str(uuid4()),
            "reason": "Cambio para cliente" if kind != "sale" else "",
        },
    )


def test_cash_sale_dispatches_once_and_ack_does_not_redeliver(client, db):
    signup, _, key = _setup(client)
    _open_shift(client)
    order = _sale(client)
    one = _request(client, kind="sale", order_id=order["id"])
    assert one.status_code == 200
    two = _request(client, kind="sale", order_id=order["id"])
    assert one.json()["id"] == two.json()["id"]
    with TestClient(app) as bridge:
        headers = {"X-Kova-Device-Key": key}
        commands = bridge.post(BASE + "/connector/poll", headers=headers).json()["commands"]
        assert commands == [
            {
                "id": one.json()["id"],
                "pin": 0,
                "expires_at": one.json()["expires_at"],
                "ttl_ms": 4000,
            }
        ]
        assert bridge.post(BASE + "/connector/poll", headers=headers).json()["commands"] == []
        ack = bridge.post(
            BASE + f"/connector/commands/{one.json()['id']}/ack",
            headers=headers,
            json={"status": "sent"},
        )
        assert ack.json()["status"] == "sent"
        assert bridge.post(BASE + "/connector/poll", headers=headers).json()["commands"] == []
    assert client.get(BASE + f"/drawer/commands/{one.json()['id']}").json()["status"] == "sent"
    device = (
        db.query(DrawerDevice).filter(DrawerDevice.tenant_id == UUID(signup["tenant_id"])).one()
    )
    assert device.key_hash and key not in device.key_hash
    assert device.pairing_hash is None
    assert "key_hash" not in client.get(BASE + "/drawer").json()


def test_no_automatic_open_for_card_old_sale_or_closed_shift(client, db):
    _setup(client)
    shift = _open_shift(client)
    card = _sale(client, method="manual_card")
    assert _request(client, kind="sale", order_id=card["id"]).status_code == 400
    cash = _sale(client)
    row = db.query(Order).filter(Order.id == UUID(cash["id"])).one()
    row.occurred_at = now() - timedelta(minutes=2)
    db.commit()
    assert _request(client, kind="sale", order_id=cash["id"]).status_code == 400
    assert db.query(DrawerCommand).count() == 0
    closed = client.post(
        f"/api/v1/shifts/{shift['id']}/close",
        headers={"Idempotency-Key": str(uuid4())},
        json={"actual_cash_amount": "150.00"},
    )
    assert closed.status_code == 201
    assert _request(client).status_code == 400


def test_expired_command_is_never_dispatched_and_revocation_stops_key(client, db):
    _, _, key = _setup(client)
    _open_shift(client)
    command = _request(client).json()
    row = db.query(DrawerCommand).filter(DrawerCommand.id == UUID(command["id"])).one()
    row.expires_at = now() - timedelta(seconds=1)
    db.commit()
    with TestClient(app) as bridge:
        headers = {"X-Kova-Device-Key": key}
        assert bridge.post(BASE + "/connector/poll", headers=headers).json()["commands"] == []
        assert (
            bridge.post(
                BASE + "/connector/poll", headers={"X-Kova-Device-Key": key[:-1] + "!"}
            ).status_code
            == 401
        )
        assert client.delete(BASE + "/drawer").status_code == 200
        assert bridge.post(BASE + "/connector/poll", headers=headers).status_code == 401
    assert client.get(BASE + "/drawer").json()["configured"] is False


def test_device_key_cannot_authorize_browser_routes_or_foreign_commands(client):
    _, _, key = _setup(client)
    _open_shift(client)
    command = _request(client).json()
    with TestClient(app) as bridge:
        headers = {"X-Kova-Device-Key": key}
        assert bridge.get(BASE + "/drawer", headers=headers).status_code == 401
        assert (
            bridge.post(
                BASE + "/drawer/open",
                headers=headers,
                json={
                    "kind": "test",
                    "reason": "Intento",
                    "request_id": str(uuid4()),
                },
            ).status_code
            == 401
        )
        assert (
            bridge.post(
                BASE + f"/connector/commands/{uuid4()}/ack",
                headers=headers,
                json={"status": "sent"},
            ).status_code
            == 404
        )
    _signup_verify_login(client, f"other-{uuid4().hex}@example.com", "Otra tienda")
    assert client.get(BASE + f"/drawer/commands/{command['id']}").status_code == 404
    assert client.get(BASE + "/drawer").json()["configured"] is False


def test_branch_selection_cannot_control_another_branch_drawer(client):
    signup, _, key = _setup(client)
    other = client.post(
        "/api/v1/branches",
        json={"name": "Otra sucursal"},
        headers={"Idempotency-Key": str(uuid4())},
    ).json()
    status = client.get(BASE + "/drawer", headers={"X-Kova-Branch": other["id"]})
    assert status.json()["configured"] is False
    with TestClient(app) as bridge:
        headers = {"X-Kova-Device-Key": key, "X-Kova-Branch": other["id"]}
        assert bridge.post(BASE + "/connector/poll", headers=headers).status_code == 200
    assert (
        client.get(BASE + "/drawer", headers={"X-Kova-Branch": signup["tenant_id"]}).json()[
            "online"
        ]
        is True
    )


def test_manual_retry_is_idempotent_and_double_click_is_rate_limited(client):
    _setup(client)
    _open_shift(client)
    nonce = str(uuid4())
    one = _request(client, request_id=nonce)
    assert one.status_code == 200
    assert _request(client, request_id=nonce).json()["id"] == one.json()["id"]
    assert _request(client).status_code == 409


def test_permissions_and_subscription_are_enforced_for_browser_and_connector(client, db):
    signup, _, key = _setup(client)
    membership = (
        db.query(Membership).filter(Membership.tenant_id == UUID(signup["tenant_id"])).one()
    )
    membership.role = "cashier"
    db.commit()
    assert client.post(BASE + "/drawer/setup", json={"name": "Intento"}).status_code == 403
    assert _request(client, kind="test").status_code == 403
    assert client.delete(BASE + "/drawer").status_code == 403
    _open_shift(client)
    assert _request(client).status_code == 200
    membership.role = "staff"
    db.commit()
    assert _request(client).status_code == 403
    membership.role = "owner"
    db.add(Subscription(tenant_id=UUID(signup["tenant_id"]), status="canceled"))
    db.commit()
    assert _request(client).status_code == 402
    with TestClient(app) as bridge:
        assert (
            bridge.post(BASE + "/connector/poll", headers={"X-Kova-Device-Key": key}).status_code
            == 403
        )


@pytest.mark.parametrize("ending", ["x", "-", "_"])
def test_connector_credentials_are_redacted_from_logs_and_sentry(ending):
    from app.observability.logging import redact_sensitive_text
    from app.observability.sentry import sanitize_sentry_event

    sample = f"{uuid4()}.{uuid4()}.{'x' * 42}{ending}"
    assert sample not in redact_sensitive_text(f"device_key={sample}")
    assert sample not in redact_sensitive_text(f"Invalid value {sample}")
    event = sanitize_sentry_event(
        {
            "request": {"headers": {"X-Kova-Device-Key": sample}},
            "extra": {"pairing_code": sample, "device_key": sample},
        }
    )
    assert event["request"]["headers"]["X-Kova-Device-Key"] == "[redacted]"
    assert event["extra"]["pairing_code"] == "[redacted]"


def test_split_payment_with_positive_cash_can_open_drawer(client):
    _setup(client)
    _open_shift(client)
    product = _create_product(client, price="50.00")
    sale = client.post(
        "/api/v1/orders",
        headers={"Idempotency-Key": str(uuid4())},
        json={
            "items": [{"product_id": product["id"], "quantity": 1}],
            "payments": [
                {"method": "cash", "amount": "20.00", "amount_tendered": "20.00"},
                {"method": "manual_card", "amount": "30.00"},
            ],
        },
    )
    assert sale.status_code == 201
    assert _request(client, kind="sale", order_id=sale.json()["id"]).status_code == 200


def test_disabled_auto_open_and_expired_pairing(client, db):
    signup, _, _ = _setup(client, auto=False)
    _open_shift(client)
    assert _request(client, kind="sale", order_id=str(uuid4())).json()["status"] == "disabled"
    response = client.post(BASE + "/drawer/setup", json={"name": "Nueva caja"})
    code = response.json()["pairing_code"]
    row = db.query(DrawerDevice).filter(DrawerDevice.tenant_id == UUID(signup["tenant_id"])).one()
    row.pairing_expires_at = now() - timedelta(seconds=1)
    db.commit()
    with TestClient(app) as bridge:
        assert bridge.post(BASE + "/connector/pair", json={"code": code}).status_code == 401


def test_drawer_tables_enforce_runtime_rls(kova_app_engine, owner_engine):
    tenant_a, tenant_b = uuid4(), uuid4()
    devices = {tenant_a: uuid4(), tenant_b: uuid4()}
    with owner_engine.begin() as connection:
        for tenant in (tenant_a, tenant_b):
            connection.execute(
                text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Caja RLS', :slug)"),
                {"id": tenant, "slug": f"drawer-rls-{tenant}"},
            )
            connection.execute(
                text(
                    "INSERT INTO drawer_devices (id, tenant_id, branch_id, name, pin, auto_open, created_at) VALUES (:id, :tenant, :tenant, 'Caja', 0, false, now())"
                ),
                {"id": devices[tenant], "tenant": tenant},
            )
            connection.execute(
                text(
                    "INSERT INTO drawer_commands (id,tenant_id,branch_id,device_id,request_key,kind,"
                    "requested_by_user_id,reason,status,created_at,expires_at) VALUES "
                    "(:id,:tenant,:tenant,:device,'rls-command','test',:user,'QA','pending',now(),now()+interval '5 seconds')"
                ),
                {"id": uuid4(), "tenant": tenant, "device": devices[tenant], "user": uuid4()},
            )
    try:
        from sqlalchemy.orm import Session

        with Session(kova_app_engine) as runtime:
            from sqlalchemy.exc import DBAPIError

            set_tenant_context(runtime, tenant_a)
            visible = runtime.query(DrawerDevice).all()
            assert [device.tenant_id for device in visible] == [tenant_a]
            assert (
                runtime.query(DrawerDevice).filter(DrawerDevice.tenant_id == tenant_b).count() == 0
            )
            assert (
                runtime.execute(
                    text("SELECT count(*) FROM drawer_commands WHERE tenant_id=:tenant"),
                    {"tenant": tenant_b},
                ).scalar()
                == 0
            )
            assert runtime.query(DrawerCommand).count() == 1
            with pytest.raises(DBAPIError), runtime.begin_nested():
                runtime.execute(
                    text(
                        "INSERT INTO drawer_commands (id,tenant_id,branch_id,device_id,request_key,kind,"
                        "requested_by_user_id,reason,status,created_at,expires_at) VALUES "
                        "(:id,:tenant,:tenant,:device,'foreign-write','test',:user,'QA','pending',now(),now()+interval '5 seconds')"
                    ),
                    {
                        "id": uuid4(),
                        "tenant": tenant_b,
                        "device": devices[tenant_b],
                        "user": uuid4(),
                    },
                )
    finally:
        with owner_engine.begin() as connection:
            connection.execute(
                text("DELETE FROM drawer_commands WHERE tenant_id IN (:a,:b)"),
                {"a": tenant_a, "b": tenant_b},
            )
            connection.execute(
                text("DELETE FROM drawer_devices WHERE tenant_id IN (:a,:b)"),
                {"a": tenant_a, "b": tenant_b},
            )
            connection.execute(
                text("DELETE FROM branches WHERE tenant_id IN (:a,:b)"),
                {"a": tenant_a, "b": tenant_b},
            )
            connection.execute(
                text("DELETE FROM tenant_receipt_settings WHERE tenant_id IN (:a,:b)"),
                {"a": tenant_a, "b": tenant_b},
            )
            connection.execute(
                text("DELETE FROM tenant_business_profiles WHERE tenant_id IN (:a,:b)"),
                {"a": tenant_a, "b": tenant_b},
            )
            connection.execute(
                text("DELETE FROM tenants WHERE id IN (:a,:b)"), {"a": tenant_a, "b": tenant_b}
            )


def test_concurrent_connector_polls_deliver_only_once(kova_app_engine, owner_engine):
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy.orm import Session

    from app.hardware import service

    tenant, device, command = uuid4(), uuid4(), uuid4()
    key = f"{tenant}.{device}.{'x' * 43}"
    with owner_engine.begin() as connection:
        connection.execute(
            text("INSERT INTO tenants (id,name,slug) VALUES (:id,'Conector concurrente',:slug)"),
            {"id": tenant, "slug": str(tenant)},
        )
        connection.execute(
            text(
                "INSERT INTO drawer_devices (id,tenant_id,branch_id,name,pin,auto_open,key_hash,key_expires_at,created_at) "
                "VALUES (:id,:tenant,:tenant,'Conector',0,true,:digest,now()+interval '1 day',now())"
            ),
            {"id": device, "tenant": tenant, "digest": service.digest(key)},
        )
        connection.execute(
            text(
                "INSERT INTO drawer_commands (id,tenant_id,branch_id,device_id,request_key,kind,"
                "requested_by_user_id,reason,status,created_at,expires_at) VALUES "
                "(:id,:tenant,:tenant,:device,'concurrent-test','test',:user,'QA','pending',now(),now()+interval '5 seconds')"
            ),
            {"id": command, "tenant": tenant, "device": device, "user": uuid4()},
        )

    def fetch():
        with Session(kova_app_engine) as runtime:
            return service.poll(runtime, service.authenticate(runtime, key))["commands"]

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: fetch(), range(2)))
        assert [item["id"] for batch in results for item in batch] == [str(command)]
    finally:
        with owner_engine.begin() as connection:
            for table in (
                "drawer_commands",
                "drawer_devices",
                "branches",
                "tenant_receipt_settings",
                "tenant_business_profiles",
            ):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant}
                )
            connection.execute(text("DELETE FROM tenants WHERE id=:tenant"), {"tenant": tenant})

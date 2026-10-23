"""Attribution is persisted, scoped and independent from attendance/payment effects."""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.appointments.models import AppointmentSale
from app.auth.models import Membership
from app.orders.models import Order, Refund
from app.tests.test_appointments import (  # noqa: F401
    BASE,
    book,
    committed_appointment_resource,
    post,
    resource,
)
from app.tests.test_crm import setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def sale_for(db, account, customer, *, status="completed", branch=None):
    tenant = UUID(account["tenant_id"])
    row = Order(
        tenant_id=tenant,
        branch_id=branch or tenant,
        customer_id=UUID(customer["id"]),
        status=status,
        subtotal_amount=Decimal("450"),
        total_amount=Decimal("450"),
    )
    db.add(row)
    db.commit()
    return row


def test_link_is_persisted_replay_safe_and_never_completes_attendance(client, db):
    account, customer = setup(client)
    appointment = book(client, customer, resource(client))
    sale = sale_for(db, account, customer)
    before_sales = db.query(Order).count()
    body = {"expected_version": 1, "sale_order_id": str(sale.id)}
    linked = post(client, f"/{appointment['id']}/sale", body, "link-once")
    assert linked.status_code == 200, linked.text
    result = linked.json()
    assert result["sale"]["id"] == str(sale.id)
    assert result["status"] == "scheduled" and result["version"] == 2
    assert post(client, f"/{appointment['id']}/sale", body, "link-once").json() == result
    assert post(client, f"/{appointment['id']}/sale", body).status_code == 409
    assert db.query(Order).count() == before_sales
    assert db.query(AppointmentSale).count() == 1
    assert client.get(BASE + f"/{appointment['id']}").json()["sale"] == result["sale"]
    history = client.get(BASE + f"/{appointment['id']}/history").json()["items"]
    assert [row["action"] for row in history] == ["created", "sale_linked"]
    assert client.get(BASE + "/reminders").json()["items"][0]["appointment_version"] == 2
    assert client.get(BASE).json()["items"][0]["sale"] == result["sale"]


def test_wrong_customer_voided_sale_and_cancelled_appointment_are_rejected(client, db):
    account, customer = setup(client)
    appointment = book(client, customer, resource(client))
    sale = sale_for(db, account, customer, status="voided")
    path = f"/{appointment['id']}/sale"
    body = {"expected_version": 1, "sale_order_id": str(sale.id)}
    assert post(client, path, body).status_code == 409
    sale.status = "completed"
    sale.customer_id = None
    db.commit()
    assert post(client, path, body).status_code == 409
    sale.customer_id = UUID(customer["id"])
    db.commit()
    assert (
        post(
            client,
            f"/{appointment['id']}/transition",
            {"expected_version": 1, "status": "cancelled"},
        ).status_code
        == 200
    )
    assert post(client, path, {**body, "expected_version": 2}).status_code == 409
    assert db.query(AppointmentSale).count() == 0


def test_sale_can_only_be_attributed_once_and_refunds_voids_remain_visible(client, db):
    account, customer = setup(client)
    appointment = book(client, customer, resource(client))
    other = book(client, customer, resource(client, name="Otro recurso"))
    sale = sale_for(db, account, customer)
    body = {"expected_version": 1, "sale_order_id": str(sale.id)}
    assert post(client, f"/{appointment['id']}/sale", body).status_code == 200
    assert post(client, f"/{other['id']}/sale", body).status_code == 409
    db.add(
        Refund(
            tenant_id=sale.tenant_id,
            branch_id=sale.branch_id,
            order_id=sale.id,
            reason="customer_request",
            refunded_amount=Decimal("150"),
        )
    )
    db.commit()
    current = client.get(BASE + f"/{appointment['id']}").json()
    assert Decimal(current["sale"]["refunded_amount"]) == Decimal("150")
    sale.status = "voided"
    db.commit()
    assert client.get(BASE + f"/{appointment['id']}").json()["sale"]["status"] == "voided"
    assert client.get(BASE + f"/{other['id']}/sales").json()["items"] == []


def test_sale_candidates_are_customer_scoped_paginated_and_missing_ids_fail_closed(client, db):
    account, customer = setup(client)
    appointment = book(client, customer, resource(client))
    first = sale_for(db, account, customer)
    second = sale_for(db, account, customer)
    response = client.get(BASE + f"/{appointment['id']}/sales?limit=1").json()
    assert response["has_more"] and len(response["items"]) == 1
    next_page = client.get(BASE + f"/{appointment['id']}/sales?limit=1&offset=1").json()
    assert not next_page["has_more"]
    assert {response["items"][0]["id"], next_page["items"][0]["id"]} == {
        str(first.id),
        str(second.id),
    }
    assert client.get(BASE + f"/{uuid4()}").status_code == 404
    assert (
        post(
            client,
            f"/{appointment['id']}/sale",
            {"expected_version": 1, "sale_order_id": str(uuid4())},
        ).status_code
        == 404
    )
    assert (
        client.post(
            BASE + f"/{appointment['id']}/sale",
            json={"expected_version": 1, "sale_order_id": str(first.id)},
        ).status_code
        == 400
    )


def test_append_only_runtime_grants_and_role_restriction(client, db):
    account, customer = setup(client)
    appointment = book(client, customer, resource(client))
    sale = sale_for(db, account, customer)
    assert (
        post(
            client,
            f"/{appointment['id']}/sale",
            {"expected_version": 1, "sale_order_id": str(sale.id)},
        ).status_code
        == 200
    )
    for command in (
        "UPDATE appointment_sales SET created_at=now()",
        "DELETE FROM appointment_sales",
    ):
        with pytest.raises(DBAPIError), db.begin_nested():
            db.execute(text("SET LOCAL ROLE kova_app"))
            db.execute(text(command))
    member = db.query(Membership).filter_by(tenant_id=UUID(account["tenant_id"])).one()
    member.role = "cashier"
    db.commit()
    assert client.get(BASE + f"/{appointment['id']}/sales").status_code == 403
    assert client.get(BASE + f"/{appointment['id']}").status_code == 403


def test_links_and_candidates_cannot_cross_branch_tenant_or_billing_gate(client, db, monkeypatch):
    account, customer = setup(client)
    appointment = book(client, customer, resource(client))
    sale = sale_for(db, account, customer)
    branch = client.post(
        "/api/v1/branches",
        json={"name": "Otra sucursal"},
        headers={"Idempotency-Key": str(uuid4())},
    ).json()["id"]
    path = f"/{appointment['id']}/sale"
    body = {"expected_version": 1, "sale_order_id": str(sale.id)}
    assert post(client, path, body, branch=branch).status_code == 404
    assert (
        client.get(
            BASE + f"/{appointment['id']}/sales", headers={"X-Kova-Branch": branch}
        ).status_code
        == 404
    )
    from app.config import settings

    monkeypatch.setattr(settings, "billing_trial_days", -1)
    assert post(client, path, body).status_code == 402
    monkeypatch.setattr(settings, "billing_trial_days", 14)
    setup(client)
    assert client.get(BASE + f"/{appointment['id']}").status_code == 404
    assert post(client, path, body).status_code == 404


def test_link_sale_keeps_csrf_protection(client, db):
    account, customer = setup(client)
    appointment = book(client, customer, resource(client))
    sale = sale_for(db, account, customer)
    from fastapi.testclient import TestClient

    from app.main import app as fastapi_app

    raw = TestClient(fastapi_app)
    raw._disable_auto_csrf = True
    raw.cookies.update(client.cookies)
    response = raw.post(
        BASE + f"/{appointment['id']}/sale",
        json={"expected_version": 1, "sale_order_id": str(sale.id)},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF validation failed"
    assert db.query(AppointmentSale).count() == 0


@pytest.fixture
def committed_sale_for_appointments(committed_appointment_resource, owner_engine):  # noqa: F811
    from datetime import UTC, datetime, timedelta

    from sqlalchemy.orm import Session

    from app.appointments import service
    from app.appointments.schemas import AppointmentCreate
    from app.branches.scope import bind_branch
    from app.db import set_tenant_context

    tenant, customer, selected = committed_appointment_resource
    appointments = []
    with Session(owner_engine) as db:
        sale = Order(
            tenant_id=tenant,
            branch_id=tenant,
            customer_id=customer,
            status="completed",
            subtotal_amount=Decimal("450"),
            total_amount=Decimal("450"),
        )
        db.add(sale)
        db.commit()
        sale_id = sale.id
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        for index in range(2):
            start = datetime.now(UTC) + timedelta(days=1, hours=index * 2)
            _, result = service.create_appointment(
                db,
                tenant,
                tenant,
                AppointmentCreate(
                    resource_id=selected["id"],
                    customer_id=customer,
                    title="Servicio concurrente",
                    starts_at=start,
                    ends_at=start + timedelta(hours=1),
                ),
                str(uuid4()),
            )
            appointments.append(UUID(result["id"]))
    try:
        yield tenant, sale_id, appointments
    finally:
        with owner_engine.begin() as connection:
            connection.execute(
                text("DELETE FROM appointment_sales WHERE tenant_id=:tenant"), {"tenant": tenant}
            )
            connection.execute(
                text("DELETE FROM orders WHERE tenant_id=:tenant"), {"tenant": tenant}
            )


@pytest.mark.parametrize("same_appointment", [False, True])
def test_concurrent_attribution_serializes_same_sale(
    kova_app_engine, owner_engine, committed_sale_for_appointments, same_appointment
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi import HTTPException
    from sqlalchemy.orm import Session

    from app.appointments import service
    from app.appointments.schemas import AppointmentSaleLink
    from app.branches.scope import bind_branch
    from app.db import set_tenant_context

    tenant, sale_id, appointments = committed_sale_for_appointments
    barrier = Barrier(2)

    def link_once(index):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            barrier.wait(timeout=10)
            try:
                status, _ = service.link_sale(
                    db,
                    tenant,
                    tenant,
                    appointments[0 if same_appointment else index],
                    AppointmentSaleLink(expected_version=1, sale_order_id=sale_id),
                    str(uuid4()),
                )
                return status
            except HTTPException as error:
                db.rollback()
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(link_once, range(2)))
    assert sorted(outcomes) == [200, 409]
    with Session(owner_engine) as db:
        assert db.query(AppointmentSale).filter_by(tenant_id=tenant).count() == 1

from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.audit.models import AuditLog
from app.fiscal.models import OrderFiscalSnapshot
from app.integrations.models import InvoiceRequest
from app.integrations.schemas import FiscalIdentity, InvoiceRecipient
from app.orders.models import Order
from app.tests.test_fiscal_global_drafts import _product, _sale, _signup_login

ISSUER = {
    "rfc": "EKU9003173C9",
    "legal_name": "Negocio",
    "postal_code": "06000",
    "tax_regime": "601",
}
RECIPIENT = {**ISSUER, "cfdi_use": "G03", "email": "cliente@example.com"}
BASE = "/api/v1/integrations"


def _request(client, order_id, key=None):
    return client.post(
        f"{BASE}/invoice-requests",
        json={"order_id": order_id, "recipient": RECIPIENT},
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def test_fiscal_identity_format_only_and_extra_fields_rejected():
    assert FiscalIdentity(**{**ISSUER, "rfc": " eku9003173c9 "}).rfc == ISSUER["rfc"]
    for field, value in [
        ("rfc", "invalid"),
        ("postal_code", "12"),
        ("legal_name", " "),
        ("tax_regime", "bad"),
    ]:
        with pytest.raises(ValidationError):
            FiscalIdentity(**{**ISSUER, field: value})
    with pytest.raises(ValidationError):
        InvoiceRecipient(**{**RECIPIENT, "email": "bad"})
    with pytest.raises(ValidationError):
        FiscalIdentity(**{**ISSUER, "provider_connected": True})


def test_requests_remain_unissued_and_replay_preserves_snapshots(client, db):
    tenant = _signup_login(client, prefix="integration")
    state = client.get(f"{BASE}/readiness").json()
    assert state["can_issue_cfdi"] is False and state["can_charge_terminal"] is False
    assert state["issuer"] is None and state["validation_scope"] == "format_only"
    order = _sale(client, _product(client)["id"])
    assert _request(client, order["id"]).status_code == 400
    assert client.put(f"{BASE}/issuer", json=ISSUER).status_code == 200
    key = str(uuid4())
    response = _request(client, order["id"], key)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "pending_provider" and body["fiscal_status"] == "not_issued"
    assert "uuid" not in body and body["issuer_snapshot"] == ISSUER
    assert _request(client, order["id"], key).json() == body
    assert _request(client, order["id"]).status_code == 409
    assert (
        client.put(f"{BASE}/issuer", json={**ISSUER, "legal_name": "Otro nombre"}).status_code
        == 200
    )
    assert client.get(f"{BASE}/invoice-requests").json()[0]["issuer_snapshot"] == ISSUER
    assert db.query(InvoiceRequest).filter_by(tenant_id=tenant).count() == 1
    fiscal = (
        db.query(OrderFiscalSnapshot).filter_by(tenant_id=tenant, order_id=UUID(order["id"])).one()
    )
    assert fiscal.individual_fiscal_status == "none"
    events = (
        db.query(AuditLog)
        .filter_by(tenant_id=tenant, action="fiscal.invoice_request_created")
        .all()
    )
    assert len(events) == 1
    assert events[0].changes == {"status": "pending_provider", "fiscal_status": "not_issued"}
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(
            text("UPDATE invoice_requests SET status='issued' WHERE id=:id"), {"id": body["id"]}
        )
        db.flush()


def test_requests_reject_foreign_or_voided_sales(client, db):
    first = _signup_login(client, prefix="first-integration")
    order = _sale(client, _product(client)["id"])
    _signup_login(client, prefix="other-integration")
    client.put(f"{BASE}/issuer", json=ISSUER)
    assert _request(client, order["id"]).status_code == 404
    assert client.get(f"{BASE}/invoice-requests").json() == []
    other_order = _sale(client, _product(client)["id"])
    row = db.get(Order, UUID(other_order["id"]))
    row.status = "voided"
    db.commit()
    assert _request(client, other_order["id"]).status_code == 400
    assert db.query(InvoiceRequest).filter_by(tenant_id=first).count() == 0


def test_invoice_request_requires_auth(client):
    assert client.get(f"{BASE}/readiness").status_code == 401
    assert client.get(f"{BASE}/invoice-requests").status_code == 401


def test_invoice_requests_keep_customer_data_owner_only(client, db):
    from app.auth.models import Membership

    tenant = _signup_login(client, prefix="privacy-integration")
    client.put(f"{BASE}/issuer", json=ISSUER)
    order = _sale(client, _product(client)["id"])
    assert _request(client, order["id"]).status_code == 201
    membership = db.query(Membership).filter_by(tenant_id=tenant).one()
    membership.role = "manager"
    db.commit()
    assert client.get(f"{BASE}/readiness").status_code == 200
    assert client.get(f"{BASE}/invoice-requests").status_code == 403
    assert client.put(f"{BASE}/issuer", json=ISSUER).status_code == 403
    assert _request(client, order["id"]).status_code == 403
    membership.role = "cashier"
    db.commit()
    assert client.get(f"{BASE}/readiness").status_code == 403


def test_invoice_request_wrong_branch_and_changed_replay_are_rejected(client, db):
    _signup_login(client, prefix="branch-integration")
    client.put(f"{BASE}/issuer", json=ISSUER)
    order = _sale(client, _product(client)["id"])
    created = client.post(
        "/api/v1/branches",
        json={"name": "Otra sucursal"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert created.status_code == 201, created.text
    branch_headers = {"X-Kova-Branch": created.json()["id"]}
    foreign_branch = client.post(
        f"{BASE}/invoice-requests",
        json={"order_id": order["id"], "recipient": RECIPIENT},
        headers={**branch_headers, "Idempotency-Key": str(uuid4())},
    )
    assert foreign_branch.status_code == 404
    key = str(uuid4())
    assert _request(client, order["id"], key).status_code == 201
    assert client.get(f"{BASE}/invoice-requests", headers=branch_headers).json() == []
    changed = client.post(
        f"{BASE}/invoice-requests",
        json={
            "order_id": order["id"],
            "recipient": {**RECIPIENT, "email": "different@example.com"},
        },
        headers={"Idempotency-Key": key},
    )
    assert changed.status_code == 400
    assert len(client.get(f"{BASE}/invoice-requests").json()) == 1

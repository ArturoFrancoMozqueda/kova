from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from app.audit.models import AuditLog
from app.auth.models import Membership


def _signup_verify_login(client, email: str = "expenses@example.com") -> dict:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": "Expense Bakery",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    body = signup.json()
    assert client.post(
        "/api/v1/auth/verify", json={"token": body["dev_verification_token"]}
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    ).status_code == 200
    return body


def test_owner_crud_expenses_with_idempotency_and_audit(client, db):
    signup = _signup_verify_login(client)
    payload = {
        "category": "servicios",
        "amount": "425.50",
        "expense_date": "2026-07-10",
        "note": "Recibo de luz",
    }
    created = client.post(
        "/api/v1/expenses",
        headers={"Idempotency-Key": "expense-create-1"},
        json=payload,
    )
    replay = client.post(
        "/api/v1/expenses",
        headers={"Idempotency-Key": "expense-create-1"},
        json=payload,
    )
    assert created.status_code == 201, created.text
    assert replay.status_code == 201
    assert replay.json() == created.json()
    expense_id = created.json()["id"]
    assert Decimal(created.json()["amount"]) == Decimal("425.50")

    outside = client.get(
        "/api/v1/expenses?start_date=2026-07-11&end_date=2026-07-31"
    )
    assert outside.status_code == 200
    assert outside.json() == []
    listed = client.get(
        "/api/v1/expenses?start_date=2026-07-01&end_date=2026-07-31"
    )
    assert [row["id"] for row in listed.json()] == [expense_id]

    updated = client.patch(
        f"/api/v1/expenses/{expense_id}",
        headers={"Idempotency-Key": "expense-update-1"},
        json={"category": "renta", "amount": "500.00", "note": None},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["category"] == "renta"
    assert Decimal(updated.json()["amount"]) == Decimal("500.00")
    assert updated.json()["note"] is None

    deleted = client.delete(
        f"/api/v1/expenses/{expense_id}",
        headers={"Idempotency-Key": "expense-delete-1"},
    )
    assert deleted.status_code == 200, deleted.text
    assert client.get("/api/v1/expenses").json() == []

    actions = {
        row.action
        for row in db.query(AuditLog)
        .filter(AuditLog.tenant_id == UUID(signup["tenant_id"]))
        .all()
    }
    assert {"expense.create", "expense.update", "expense.delete"} <= actions


def test_expense_validation_and_permissions(client, db):
    email = f"expense-role-{uuid4().hex}@example.com"
    signup = _signup_verify_login(client, email)
    invalid = client.post(
        "/api/v1/expenses",
        headers={"Idempotency-Key": "expense-invalid"},
        json={
            "category": "inventada",
            "amount": "-1.00",
            "expense_date": date.today().isoformat(),
        },
    )
    assert invalid.status_code == 422

    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = "cashier"
    db.commit()
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert client.get("/api/v1/expenses").status_code == 403


def test_expense_update_rejects_null_required_fields_and_allows_note_clear(client, db):
    signup = _signup_verify_login(client, "expense-null@example.com")
    created = client.post(
        "/api/v1/expenses",
        headers={"Idempotency-Key": "expense-null-create"},
        json={
            "category": "servicios",
            "amount": "425.50",
            "expense_date": "2026-07-10",
            "note": "Recibo de luz",
        },
    )
    assert created.status_code == 201, created.text
    expense = created.json()
    url = f"/api/v1/expenses/{expense['id']}"

    for field in ("category", "amount", "expense_date"):
        rejected = client.patch(
            url,
            headers={"Idempotency-Key": "expense-null-update"},
            json={field: None, "note": None},
        )
        assert rejected.status_code == 422, (field, rejected.text)
        assert any(error["loc"] == ["body", field] for error in rejected.json()["detail"])

    assert client.get("/api/v1/expenses").json() == [expense]
    assert db.query(AuditLog).filter(
        AuditLog.tenant_id == UUID(signup["tenant_id"]),
        AuditLog.action == "expense.update",
    ).count() == 0

    cleared = client.patch(
        url,
        headers={"Idempotency-Key": "expense-null-update"},
        json={"note": None},
    )
    assert cleared.status_code == 200, cleared.text
    updated = cleared.json()
    assert updated["note"] is None
    for field in ("category", "amount", "expense_date"):
        assert updated[field] == expense[field]

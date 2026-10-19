from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.config import settings
from app.db import set_tenant_context
from app.orders.models import Order, Payment
from app.reconciliation import service
from app.reconciliation.models import ImportBatch, SettlementEntry
from app.reconciliation.parser import HEADER, preview
from app.reconciliation.schemas import MatchAction
from app.tests.test_catalog import _signup_verify_login

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def csv_content(*, gross="100.00", fee="3.00", net="97.00", ref="***1234", method="bank_transfer"):
    return (
        ",".join(HEADER)
        + "\n"
        + ",".join(
            [
                datetime.now(UTC).isoformat(),
                gross,
                fee,
                net,
                "MXN",
                method,
                ref,
            ]
        )
        + "\n"
    )


def setup(client, db):
    account = _signup_verify_login(
        client, f"reconciliation-{uuid4().hex}@example.com", "Conciliación"
    )
    tenant = UUID(account["tenant_id"])
    order = Order(
        tenant_id=tenant,
        branch_id=tenant,
        subtotal_amount=Decimal("100.00"),
        total_amount=Decimal("100.00"),
        status="completed",
    )
    db.add(order)
    db.flush()
    payment = Payment(
        tenant_id=tenant,
        order_id=order.id,
        method="bank_transfer",
        amount_amount=Decimal("100.00"),
        change_due_amount=0,
        reference="REF1234",
    )
    db.add(payment)
    db.commit()
    return account, order, payment


def imported(client, content, key=None):
    checked = client.post("/api/v1/reconciliation/imports/preview", json={"csv_content": content})
    assert checked.status_code == 200, checked.text
    parsed = checked.json()
    assert not parsed["errors"]
    payload = {
        "csv_content": content,
        "content_sha256": parsed["content_sha256"],
        "parser_version": 1,
        "selected_rows": [row["row_number"] for row in parsed["rows"]],
    }
    result = client.post(
        "/api/v1/reconciliation/imports/commit",
        json=payload,
        headers={"Idempotency-Key": key or str(uuid4())},
    )
    return result, payload


def suggest(client, entry_id, key=None):
    return client.post(
        f"/api/v1/reconciliation/entries/{entry_id}/suggest",
        json={},
        headers={"Idempotency-Key": key or str(uuid4())},
    )


def act(client, entry, match, action, key=None, **extra):
    return client.post(
        f"/api/v1/reconciliation/entries/{entry}/matches/{match['id']}/{action}",
        headers={"Idempotency-Key": key or str(uuid4())},
        json={"expected_version": match["version"], **extra},
    )


def test_preview_no_persistence_and_import_replay_duplicate_selection(client, db):
    account, _, _ = setup(client, db)
    content = csv_content()
    checked = client.post("/api/v1/reconciliation/imports/preview", json={"csv_content": content})
    assert checked.status_code == 200, checked.text
    assert db.query(ImportBatch).count() == 0
    assert db.query(SettlementEntry).count() == 0
    assert checked.json()["rows"][0]["net_amount"] == "97.00"
    result, payload = imported(client, content, "import-once")
    assert result.status_code == 200, result.text
    replay = client.post(
        "/api/v1/reconciliation/imports/commit",
        json=payload,
        headers={"Idempotency-Key": "import-once"},
    )
    assert replay.json() == result.json()
    duplicate = client.post(
        "/api/v1/reconciliation/imports/commit",
        json=payload,
        headers={"Idempotency-Key": "import-other-key"},
    )
    assert duplicate.json() == result.json()
    assert (
        db.query(ImportBatch).filter(ImportBatch.tenant_id == UUID(account["tenant_id"])).count()
        == 1
    )
    assert db.query(SettlementEntry).count() == 1
    assert "csv_content" not in ImportBatch.__table__.columns
    invalid = {**payload, "selected_rows": [999]}
    assert (
        client.post(
            "/api/v1/reconciliation/imports/commit",
            json=invalid,
            headers={"Idempotency-Key": "invalid-selection"},
        ).status_code
        == 400
    )


def test_suggest_confirm_replay_reverse_preserves_payment_and_audit_privacy(client, db):
    _, order, payment = setup(client, db)
    result, _ = imported(client, csv_content())
    assert result.status_code == 200, result.text
    entry = client.get("/api/v1/reconciliation/entries").json()["entries"][0]
    assert entry["status"] == "unmatched"
    suggestions = suggest(client, entry["id"])
    assert suggestions.status_code == 200, suggestions.text
    candidate = suggestions.json()["matches"][0]
    assert candidate["status"] == "suggested" and candidate["matched_amount"] == "97.00"
    assert suggestions.json()["matched_amount"] == "0.00"
    confirmed = act(client, entry["id"], candidate, "confirm", key="confirm-once")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "matched"
    assert (
        act(client, entry["id"], candidate, "confirm", key="confirm-once").json()
        == confirmed.json()
    )
    assert act(client, entry["id"], candidate, "confirm").status_code == 409
    matched = confirmed.json()["matches"][0]
    assert act(client, entry["id"], matched, "reverse").status_code == 400
    reversed_response = act(
        client, entry["id"], matched, "reverse", reason="Corrección documentada"
    )
    assert reversed_response.status_code == 200, reversed_response.text
    assert reversed_response.json()["status"] == "unmatched"
    assert reversed_response.json()["matches"][0]["status"] == "reversed"
    db.refresh(order)
    db.refresh(payment)
    assert order.total_amount == Decimal("100.00") and order.status == "completed"
    assert payment.amount_amount == Decimal("100.00") and payment.method == "bank_transfer"
    entries = db.query(AuditLog).filter(AuditLog.action.like("reconciliation.%")).all()
    assert "REF1234" not in str([entry.changes for entry in entries])
    assert "Corrección documentada" not in str([entry.changes for entry in entries])


def test_confirm_rechecks_available_amount_and_suggest_can_refresh_partial(client, db):
    setup(client, db)
    imported(client, csv_content(ref="***1111"))
    imported(client, csv_content(gross="50.00", fee="0.00", net="50.00", ref="***2222"))
    entries = client.get("/api/v1/reconciliation/entries").json()["entries"]
    entries.sort(key=lambda row: Decimal(row["net_amount"]), reverse=True)
    first = suggest(client, entries[0]["id"]).json()
    second = suggest(client, entries[1]["id"]).json()
    assert act(client, first["id"], first["matches"][0], "confirm").status_code == 200
    assert act(client, second["id"], second["matches"][0], "confirm").status_code == 409
    refreshed = suggest(client, second["id"])
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["matches"][0]["matched_amount"] == "3.00"
    partial = act(client, second["id"], refreshed.json()["matches"][0], "confirm")
    assert partial.status_code == 200, partial.text
    assert partial.json()["status"] == "partially_matched"
    assert partial.json()["remaining_amount"] == "47.00"


def test_reject_and_voided_sale_are_not_confirmed(client, db):
    _, order, _ = setup(client, db)
    imported(client, csv_content())
    entry = client.get("/api/v1/reconciliation/entries").json()["entries"][0]
    suggestion = suggest(client, entry["id"]).json()["matches"][0]
    rejected = act(client, entry["id"], suggestion, "reject")
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["matches"][0]["status"] == "rejected"
    assert rejected.json()["status"] == "unmatched"
    imported(client, csv_content(ref="***2345"))
    other = next(
        row
        for row in client.get("/api/v1/reconciliation/entries").json()["entries"]
        if row["id"] != entry["id"]
    )
    candidate = suggest(client, other["id"]).json()["matches"][0]
    order.status = "voided"
    db.commit()
    assert act(client, other["id"], candidate, "confirm").status_code == 409


def test_roles_billing_tenant_and_branch_boundaries(client, db, monkeypatch):
    account, _, _ = setup(client, db)
    imported(client, csv_content())
    entry = client.get("/api/v1/reconciliation/entries").json()["entries"][0]
    branch = client.post(
        "/api/v1/branches", json={"name": "Norte"}, headers={"Idempotency-Key": str(uuid4())}
    ).json()
    assert (
        client.get(
            "/api/v1/reconciliation/entries", headers={"X-Kova-Branch": branch["id"]}
        ).json()["entries"]
        == []
    )
    forbidden_branch = client.post(
        f"/api/v1/reconciliation/entries/{entry['id']}/suggest",
        json={},
        headers={"Idempotency-Key": str(uuid4()), "X-Kova-Branch": branch["id"]},
    )
    assert forbidden_branch.status_code == 404
    member = db.query(Membership).filter(Membership.tenant_id == UUID(account["tenant_id"])).one()
    member.role = "cashier"
    db.commit()
    assert client.get("/api/v1/reconciliation/entries").status_code == 403
    assert (
        client.post(
            "/api/v1/reconciliation/imports/preview", json={"csv_content": csv_content()}
        ).status_code
        == 403
    )
    member.role = "owner"
    db.commit()
    monkeypatch.setattr(settings, "billing_trial_days", -1)
    assert client.get("/api/v1/reconciliation/entries").status_code == 402
    monkeypatch.undo()
    setup(client, db)
    assert client.get("/api/v1/reconciliation/entries").json()["entries"] == []
    assert suggest(client, entry["id"]).status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        ("100.00", "NaN"),
        ("97.00", "96.00"),
        ("***1234", "1234567812345678"),
        ("***1234", "***123456"),
        ("bank_transfer", "cash"),
        ("MXN", "USD"),
        ("100.00", "=100"),
        ("3.00", "3.001"),
        ("***1234", "<script>"),
    ],
)
def test_parser_rejects_invalid_or_sensitive_cells_without_echo(change):
    content = csv_content().replace(*change)
    result = preview(content)
    assert result.errors and not result.rows
    assert change[1] not in result.errors[0].message


def test_parser_bounds_header_timezone_duplicates_and_reordered_whitespace():
    content = csv_content()
    parsed = preview(content)
    assert not parsed.errors
    assert preview(content.replace("100.00", "100.0")).content_sha256 == parsed.content_sha256
    assert preview(content + content.splitlines()[1] + "\n").errors
    no_zone = content.replace("+00:00", "")
    assert preview(no_zone).errors
    with pytest.raises(HTTPException):
        preview(content.replace("settled_at", "bank_account"))
    with pytest.raises(HTTPException):
        preview(content * 5000)
    with pytest.raises(HTTPException):
        preview(",".join(HEADER) + "\n")


def test_concurrent_confirmation_does_not_overallocate_payment(owner_engine, kova_app_engine):
    tenant, actor, order_id, payment_id = uuid4(), uuid4(), uuid4(), uuid4()
    batch_id = uuid4()
    entry_ids, match_ids = [uuid4(), uuid4()], [uuid4(), uuid4()]
    with owner_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                "VALUES (:id,:email,'test-only-hash',true)"
            ),
            {"id": actor, "email": f"reconciliation-{actor}@example.com"},
        )
        conn.execute(
            text("INSERT INTO tenants(id,name,slug) VALUES (:id,'Reconciliation race',:slug)"),
            {"id": tenant, "slug": str(tenant)},
        )
        conn.execute(
            text("INSERT INTO memberships(tenant_id,user_id,role) VALUES (:tenant,:user,'owner')"),
            {"tenant": tenant, "user": actor},
        )
        conn.execute(
            text(
                "INSERT INTO orders(id,tenant_id,branch_id,subtotal_amount,total_amount,status) VALUES (:id,:tenant,:tenant,100,100,'completed')"
            ),
            {"id": order_id, "tenant": tenant},
        )
        conn.execute(
            text(
                "INSERT INTO payments(id,tenant_id,order_id,method,amount_amount,change_due_amount) VALUES (:id,:tenant,:order,'bank_transfer',100,0)"
            ),
            {"id": payment_id, "tenant": tenant, "order": order_id},
        )
        conn.execute(
            text(
                "INSERT INTO reconciliation_import_batches(id,tenant_id,branch_id,content_sha256,parser_version,source_type,row_count,created_by_user_id,created_at) VALUES (:id,:tenant,:tenant,:hash,1,'manual_csv',2,:actor,now())"
            ),
            {
                "id": batch_id,
                "tenant": tenant,
                "hash": str(uuid4()).replace("-", "") * 2,
                "actor": actor,
            },
        )
        for entry, match in zip(entry_ids, match_ids, strict=True):
            conn.execute(
                text(
                    "INSERT INTO settlement_entries(id,tenant_id,branch_id,batch_id,settled_at,gross_amount,fee_amount,net_amount,currency,payment_method,external_reference_masked,row_fingerprint) VALUES (:id,:tenant,:tenant,:batch,now(),80,0,80,'MXN','bank_transfer','***1234',:hash)"
                ),
                {"id": entry, "tenant": tenant, "batch": batch_id, "hash": entry.hex * 2},
            )
            conn.execute(
                text(
                    "INSERT INTO reconciliation_matches(id,tenant_id,branch_id,settlement_entry_id,payment_id,order_id,matched_amount,status,version,reasons,created_at,updated_at) VALUES (:id,:tenant,:tenant,:entry,:payment,:order,80,'suggested',1,'[]',now(),now())"
                ),
                {
                    "id": match,
                    "tenant": tenant,
                    "entry": entry,
                    "payment": payment_id,
                    "order": order_id,
                },
            )
    barrier = Barrier(2)

    def run(index):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            barrier.wait(timeout=10)
            try:
                service.act_on_match(
                    db,
                    tenant,
                    actor,
                    entry_ids[index],
                    match_ids[index],
                    "confirm",
                    MatchAction(expected_version=1),
                    str(uuid4()),
                )
                return 200
            except HTTPException as error:
                db.rollback()
                return error.status_code

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, [0, 1]))
        assert sorted(results) == [200, 409]
        with owner_engine.connect() as conn:
            assert conn.execute(
                text(
                    "SELECT sum(matched_amount) FROM reconciliation_matches WHERE tenant_id=:tenant AND status='confirmed'"
                ),
                {"tenant": tenant},
            ).scalar_one() == Decimal("80.00")
            assert conn.execute(
                text("SELECT amount_amount FROM payments WHERE id=:id"), {"id": payment_id}
            ).scalar_one() == Decimal("100.00")
        with Session(kova_app_engine) as db:
            set_tenant_context(db, uuid4())
            assert service.list_entries(db, tenant)["entries"] == []
    finally:
        with owner_engine.begin() as conn:
            for table in (
                "reconciliation_matches",
                "settlement_entries",
                "reconciliation_import_batches",
                "audit_logs",
                "idempotency_keys",
                "payments",
                "orders",
            ):
                conn.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id=:tenant"), {"tenant": tenant}
                )
            conn.execute(text("DELETE FROM tenants WHERE id=:tenant"), {"tenant": tenant})
            conn.execute(text("DELETE FROM users WHERE id=:user"), {"user": actor})

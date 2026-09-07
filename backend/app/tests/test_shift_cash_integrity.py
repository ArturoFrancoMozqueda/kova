from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import UTC, datetime
from decimal import Decimal
from threading import Event
from uuid import uuid4

from sqlalchemy.orm import Session

from app.audit.models import AuditLog
from app.auth.models import User
from app.idempotency.models import IdempotencyKey
from app.shifts import repository as shift_repo
from app.shifts import service as shift_service
from app.shifts.models import CashMovement, Shift
from app.shifts.schemas import CashMovementCreate, ShiftCloseCreate
from app.tenants.models import Tenant


def _signup_and_open_shift(client) -> dict:
    suffix = uuid4().hex
    signup_response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": f"shift-integrity-{suffix}@example.com",
            "password": "S3cur3pass!",
            "tenant_name": f"Shift Integrity {suffix}",
            "accepted_terms": True,
        },
    )
    assert signup_response.status_code == 201, signup_response.text
    signup = signup_response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"shift-integrity-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    opened = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"open-{suffix}"},
        json={"opening_cash_amount": "100.00"},
    )
    assert opened.status_code == 201, opened.text
    return opened.json()


def test_cash_movement_requires_and_replays_idempotency_key(client) -> None:
    shift = _signup_and_open_shift(client)
    url = f"/api/v1/shifts/{shift['id']}/cash-movements"
    payload = {"type": "cash_out", "amount": "20.00", "reason": "Compra de insumos"}

    missing_key = client.post(url, json=payload)
    assert missing_key.status_code == 400

    key = f"cash-movement-{uuid4().hex}"
    first = client.post(url, headers={"Idempotency-Key": key}, json=payload)
    replay = client.post(url, headers={"Idempotency-Key": key}, json=payload)

    assert first.status_code == 201, first.text
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()

    detail = client.get(f"/api/v1/shifts/{shift['id']}")
    assert detail.status_code == 200, detail.text
    cash_out = [
        movement for movement in detail.json()["movements"] if movement["type"] == "cash_out"
    ]
    assert len(cash_out) == 1
    assert cash_out[0]["amount"] == "20.00"

    different_payload = client.post(
        url,
        headers={"Idempotency-Key": key},
        json={**payload, "amount": "25.00"},
    )
    assert different_payload.status_code == 400
    assert "different request body" in different_payload.text


def test_close_waits_for_inflight_movement_and_includes_it(owner_engine, monkeypatch) -> None:
    tenant_id = uuid4()
    shift_id = uuid4()
    user_id = uuid4()
    with Session(owner_engine) as seed:
        seed.add(Tenant(id=tenant_id, name="Concurrent Drawer", slug=f"drawer-{uuid4().hex}"))
        now = datetime.now(UTC)
        seed.add(
            User(
                id=user_id,
                email=f"concurrent-drawer-{uuid4().hex}@example.com",
                hashed_password="test-only",
                is_email_verified=True,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        )
        seed.add(
            Shift(
                id=shift_id,
                tenant_id=tenant_id,
                opened_by_user_id=user_id,
                status="open",
                opening_cash_amount=Decimal("100.00"),
            )
        )
        seed.flush()
        seed.add(
            CashMovement(
                tenant_id=tenant_id,
                shift_id=shift_id,
                type="opening_balance",
                amount=Decimal("100.00"),
                reason="Opening balance",
                created_by_user_id=user_id,
            )
        )
        seed.commit()

    writer_holds_shift = Event()
    allow_writer_to_finish = Event()
    close_attempted_shift_lock = Event()
    original_create_movement = shift_repo.create_cash_movement
    original_lock_shift = shift_repo.get_shift_for_update

    def pause_while_holding_shift(*args, **kwargs):
        writer_holds_shift.set()
        assert allow_writer_to_finish.wait(timeout=5)
        return original_create_movement(*args, **kwargs)

    monkeypatch.setattr(shift_repo, "create_cash_movement", pause_while_holding_shift)

    def observe_close_lock_attempt(*args, **kwargs):
        close_attempted_shift_lock.set()
        return original_lock_shift(*args, **kwargs)

    def record_movement() -> tuple[int, dict]:
        with Session(owner_engine) as worker_db:
            return shift_service.record_cash_movement(
                worker_db,
                tenant_id=tenant_id,
                user_id=user_id,
                shift_id=shift_id,
                body=CashMovementCreate(
                    type="cash_in", amount=Decimal("10.00"), reason="Cambio adicional"
                ),
                idempotency_key=f"movement-{uuid4().hex}",
            )

    def close_drawer() -> tuple[int, dict]:
        with Session(owner_engine) as worker_db:
            return shift_service.close_shift(
                worker_db,
                tenant_id=tenant_id,
                user_id=user_id,
                shift_id=shift_id,
                body=ShiftCloseCreate(actual_cash_amount=Decimal("110.00")),
                idempotency_key=f"close-{uuid4().hex}",
            )

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            movement_future = pool.submit(record_movement)
            assert writer_holds_shift.wait(timeout=5)
            monkeypatch.setattr(shift_repo, "get_shift_for_update", observe_close_lock_attempt)
            close_future = pool.submit(close_drawer)
            assert close_attempted_shift_lock.wait(timeout=5)

            # The close must be waiting on the same shift row while the cash
            # writer is still in flight. Without the common lock it completes
            # with a stale 100.00 snapshot here.
            try:
                close_future.result(timeout=0.25)
            except TimeoutError:
                pass
            else:
                raise AssertionError("shift close did not wait for the cash writer")

            allow_writer_to_finish.set()
            movement_status, _ = movement_future.result(timeout=5)
            close_status, closed = close_future.result(timeout=5)

        assert movement_status == 201
        assert close_status == 201
        assert closed["expected_cash_amount"] == "110.00"
        assert closed["variance_amount"] == "0.00"

        with Session(owner_engine) as check:
            persisted = check.get(Shift, shift_id)
            assert persisted is not None
            assert persisted.status == "closed"
            assert persisted.expected_cash_amount == Decimal("110.00")
            total = sum(
                movement.amount
                for movement in check.query(CashMovement).filter_by(shift_id=shift_id).all()
            )
            assert total == Decimal("110.00")
    finally:
        allow_writer_to_finish.set()
        with Session(owner_engine) as cleanup:
            cleanup.query(AuditLog).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(IdempotencyKey).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(CashMovement).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(Shift).filter_by(tenant_id=tenant_id).delete()
            cleanup.query(User).filter_by(id=user_id).delete()
            cleanup.query(Tenant).filter_by(id=tenant_id).delete()
            cleanup.commit()

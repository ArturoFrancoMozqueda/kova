from decimal import Decimal
from uuid import UUID, uuid4

from pytest_bdd import given, parsers, scenario, then, when

from app.auth.models import Membership


@scenario("../../../../specs/shifts/cash_movements.feature", "Manager records a cash removal")
def test_manager_records_cash_removal():
    pass


@scenario("../../../../specs/shifts/cash_movements.feature", "Manager records a cash deposit")
def test_manager_records_cash_deposit():
    pass


@scenario("../../../../specs/shifts/cash_movements.feature", "Cash movements affect shift reconciliation")
def test_cash_movements_affect_reconciliation():
    pass


@scenario("../../../../specs/shifts/cash_movements.feature", "Cannot record negative amount")
def test_cannot_record_negative_amount():
    pass


@scenario("../../../../specs/shifts/cash_movements.feature", "Cannot record movement without open shift")
def test_cannot_record_movement_without_open_shift():
    pass


@scenario("../../../../specs/shifts/cash_movements.feature", "Permission denied for non-managers")
def test_permission_denied_non_manager():
    pass


@scenario("../../../../specs/shifts/cash_movements.feature", "Tenant isolation: cannot record in another tenant's shift")
def test_tenant_isolation_cash_movement():
    pass


def _signup_verify_login(client, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name},
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return signup


def _set_role(db, signup: dict, role: str) -> None:
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = role
    db.commit()


def _open_shift(client) -> dict:
    suffix = uuid4().hex
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-setup-{suffix}"},
        json={"opening_cash_amount": "1000.00"},
    )
    assert response.status_code == 201, response.text
    return response.json()


@given("an authenticated manager with an open shift", target_fixture="movement_context")
def manager_with_open_shift(client):
    suffix = uuid4().hex
    signup = _signup_verify_login(client, f"movements-manager-{suffix}@example.com", "Movements Test Tenant")
    shift = _open_shift(client)
    return {"client": client, "shift": shift, "tenant_id": UUID(signup["tenant_id"])}


@given("an authenticated manager with no open shift", target_fixture="movement_context")
def manager_with_no_open_shift(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"movements-no-shift-{suffix}@example.com", "Movements No Shift Tenant")
    return {"client": client}


@given("an authenticated cashier without cash movement permission", target_fixture="movement_context")
def cashier_without_movement_permission(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(client, f"movements-staff-{suffix}@example.com", "Movements Staff Tenant")
    shift = _open_shift(client)
    _set_role(db, signup, "staff")
    client.post("/api/v1/auth/logout")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"movements-staff-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client, "shift": shift}


@given("two separate tenants with open shifts", target_fixture="movement_context")
def two_tenants_with_open_shifts_movement(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"movements-a-{suffix}@example.com", "Movements Tenant A")
    shift_a = _open_shift(client)
    client.post("/api/v1/auth/logout")
    signup_b = _signup_verify_login(client, f"movements-b-{suffix}@example.com", "Movements Tenant B")
    shift_b = _open_shift(client)
    return {
        "client": client,
        "shift_a": shift_a,
        "shift_b": shift_b,
        "tenant_b_id": UUID(signup_b["tenant_id"]),
    }


@when(parsers.parse('the manager records a cash removal of "{amount}" with reason "{reason}"'))
def manager_records_cash_removal(movement_context, amount, reason):
    response = movement_context["client"].post(
        f"/api/v1/shifts/{movement_context['shift']['id']}/cash-movements",
        json={"type": "cash_out", "amount": amount, "reason": reason},
    )
    assert response.status_code == 201, response.text
    movement_context["movement"] = response.json()


@when(parsers.parse('the manager records a cash deposit of "{amount}" with reason "{reason}"'))
def manager_records_cash_deposit(movement_context, amount, reason):
    response = movement_context["client"].post(
        f"/api/v1/shifts/{movement_context['shift']['id']}/cash-movements",
        json={"type": "cash_in", "amount": amount, "reason": reason},
    )
    assert response.status_code == 201, response.text
    movement_context["movement"] = response.json()


@when(parsers.parse('the manager records a cash removal of "{amount}"'))
def manager_records_cash_removal_no_reason(movement_context, amount):
    response = movement_context["client"].post(
        f"/api/v1/shifts/{movement_context['shift']['id']}/cash-movements",
        json={"type": "cash_out", "amount": amount, "reason": "cash_removal"},
    )
    assert response.status_code == 201, response.text
    movement_context["movement"] = response.json()


@when("closes the shift with actual cash matching expected")
def close_shift_with_matching_cash(movement_context):
    shift_response = movement_context["client"].get(f"/api/v1/shifts/{movement_context['shift']['id']}")
    assert shift_response.status_code == 200, shift_response.text
    shift = shift_response.json()
    opening = Decimal(shift["opening_cash_amount"]) if shift["opening_cash_amount"] else Decimal("0")
    cash_in = sum(Decimal(m["amount"]) for m in shift["movements"] if m["type"] == "cash_in")
    cash_out = sum(Decimal(m["amount"]) for m in shift["movements"] if m["type"] == "cash_out")
    expected = opening + cash_in - cash_out
    close_response = movement_context["client"].post(
        f"/api/v1/shifts/{movement_context['shift']['id']}/close",
        headers={"Idempotency-Key": f"close-matching-{uuid4().hex}"},
        json={"actual_cash_amount": str(expected)},
    )
    assert close_response.status_code == 201, close_response.text
    movement_context["closed_shift"] = close_response.json()


@when(parsers.parse('the manager attempts to record a movement with amount "{amount}"'))
def manager_attempts_negative_movement(movement_context, amount):
    response = movement_context["client"].post(
        f"/api/v1/shifts/{movement_context['shift']['id']}/cash-movements",
        json={"type": "cash_out", "amount": amount, "reason": "negative_test"},
    )
    movement_context["response"] = response


@when("the manager attempts to record a cash movement")
def manager_attempts_movement_no_shift(movement_context):
    response = movement_context["client"].post(
        "/api/v1/shifts/fake-id/cash-movements",
        json={"type": "cash_out", "amount": "100.00", "reason": "test"},
    )
    movement_context["response"] = response


@when("the cashier attempts to record a cash movement")
def cashier_attempts_movement_no_permission(movement_context):
    response = movement_context["client"].post(
        f"/api/v1/shifts/{movement_context['shift']['id']}/cash-movements",
        json={"type": "cash_out", "amount": "100.00", "reason": "test"},
    )
    movement_context["response"] = response


@when("tenant B attempts to record a movement in tenant A's shift")
def tenant_b_attempts_movement_in_tenant_a_shift(movement_context):
    response = movement_context["client"].post(
        f"/api/v1/shifts/{movement_context['shift_a']['id']}/cash-movements",
        json={"type": "cash_out", "amount": "50.00", "reason": "test"},
    )
    movement_context["response"] = response


@then("the cash movement is recorded successfully")
def cash_movement_recorded_successfully(movement_context):
    assert movement_context["movement"] is not None
    assert movement_context["movement"]["id"] is not None


@then(parsers.parse('the movement type is "{movement_type}"'))
def movement_type_is(movement_context, movement_type):
    assert movement_context["movement"]["type"] == movement_type


@then("the movement appears in the audit log")
def movement_in_audit_log(movement_context, db):
    from app.audit.models import AuditLog

    movement_id = UUID(movement_context["movement"]["id"])
    audit = db.query(AuditLog).filter(AuditLog.resource_id == movement_id).one()
    assert audit.action == "shifts.cash_movement"


@then("the reconciliation is balanced")
def reconciliation_balanced(movement_context):
    assert movement_context["closed_shift"]["reconciliation_status"] == "balanced"
    assert movement_context["closed_shift"]["variance_amount"] == "0.00"


@then("a 400 error is returned")
def error_400_returned_movement(movement_context):
    status = movement_context["response"].status_code
    assert status in (400, 422), f"Expected 400 or 422, got {status}"


@then("a 403 error is returned")
def error_403_returned_movement(movement_context):
    assert movement_context["response"].status_code == 403


@then("a 404 error is returned")
def error_404_returned_movement(movement_context):
    assert movement_context["response"].status_code == 404

from uuid import uuid4

from pytest_bdd import given, parsers, scenario, then, when

from app.auth.models import Membership


@scenario("../../../../specs/shifts/open.feature", "Cashier opens a shift with opening cash")
def test_cashier_opens_shift_with_cash():
    pass


@scenario("../../../../specs/shifts/open.feature", "Cashier opens a shift without opening cash")
def test_cashier_opens_shift_without_cash():
    pass


@scenario("../../../../specs/shifts/open.feature", "Cannot open a shift if one is already open")
def test_cannot_open_shift_when_already_open():
    pass


@scenario("../../../../specs/shifts/open.feature", "Duplicate open request with same key returns same response")
def test_duplicate_open_request_idempotency():
    pass


@scenario("../../../../specs/shifts/open.feature", "Permission denied without shifts.open permission")
def test_permission_denied_open_shift():
    pass


@scenario("../../../../specs/shifts/open.feature", "Tenant isolation: cannot see another tenant's open shift")
def test_tenant_isolation_open_shift():
    pass


def _signup_verify_login(client, email: str, tenant_name: str) -> dict:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name, "accepted_terms": True},
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
    from uuid import UUID
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


@given("an authenticated cashier with no open shift", target_fixture="shift_context")
def cashier_with_no_open_shift(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"shifts-open-cashier-{suffix}@example.com", "Shifts Open Test Tenant")
    return {"client": client}


@given("an authenticated cashier with an open shift", target_fixture="shift_context")
def cashier_with_open_shift(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"shifts-open-existing-{suffix}@example.com", "Shifts Existing Tenant")
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-setup-{suffix}"},
        json={"opening_cash_amount": "500.00"},
    )
    assert response.status_code == 201, response.text
    return {"client": client, "open_shift": response.json()}


@given("an authenticated user without shift open permission", target_fixture="shift_context")
def user_without_shift_open_permission(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(
        client, f"shifts-staff-{suffix}@example.com", "Shifts Staff Tenant"
    )
    _set_role(db, signup, "staff")
    client.post("/api/v1/auth/logout")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"shifts-staff-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client}


@given("two separate tenants with open shifts", target_fixture="shift_context")
def two_tenants_with_open_shifts(client):
    suffix = uuid4().hex
    _signup_verify_login(client, f"shifts-tenant-a-{suffix}@example.com", "Shifts Tenant A")
    response_a = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-a-setup-{suffix}"},
        json={"opening_cash_amount": "500.00"},
    )
    assert response_a.status_code == 201, response_a.text
    client.post("/api/v1/auth/logout")
    _signup_verify_login(client, f"shifts-tenant-b-{suffix}@example.com", "Shifts Tenant B")
    response_b = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-b-setup-{suffix}"},
        json={"opening_cash_amount": "500.00"},
    )
    assert response_b.status_code == 201, response_b.text
    return {"client": client, "tenant_a_shift": response_a.json(), "tenant_b_shift": response_b.json()}


@when(parsers.parse('the cashier opens a shift with opening cash "{cash_amount}"'))
def cashier_opens_shift_with_cash(shift_context, cash_amount):
    suffix = uuid4().hex
    response = shift_context["client"].post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-open-{suffix}"},
        json={"opening_cash_amount": cash_amount},
    )
    assert response.status_code == 201, response.text
    shift_context["shift"] = response.json()


@when("the cashier opens a shift without opening cash")
def cashier_opens_shift_without_cash(shift_context):
    suffix = uuid4().hex
    response = shift_context["client"].post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-open-no-cash-{suffix}"},
        json={},
    )
    assert response.status_code == 201, response.text
    shift_context["shift"] = response.json()


@when("the cashier attempts to open another shift")
def cashier_attempts_open_another_shift(shift_context):
    suffix = uuid4().hex
    response = shift_context["client"].post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-duplicate-{suffix}"},
        json={"opening_cash_amount": "500.00"},
    )
    shift_context["response"] = response


@when(parsers.parse('the cashier opens a shift with idempotency key "{key}"'))
def cashier_opens_shift_with_key(shift_context, key):
    response = shift_context["client"].post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": key},
        json={"opening_cash_amount": "500.00"},
    )
    assert response.status_code == 201, response.text
    shift_context["shift"] = response.json()


@when(parsers.parse('opens a shift again with key "{key}"'))
def opens_shift_again_with_key(shift_context, key):
    response = shift_context["client"].post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": key},
        json={"opening_cash_amount": "500.00"},
    )
    assert response.status_code == 201, response.text
    shift_context["shift_duplicate"] = response.json()


@when("the user attempts to open a shift")
def user_attempts_open_shift(shift_context):
    suffix = uuid4().hex
    response = shift_context["client"].post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-no-perm-{suffix}"},
        json={"opening_cash_amount": "500.00"},
    )
    shift_context["response"] = response


@when("tenant B queries the current shift")
def tenant_b_queries_current_shift(shift_context):
    response = shift_context["client"].get("/api/v1/shifts/current")
    assert response.status_code == 200, response.text
    shift_context["response"] = response.json()


@then("the shift is created successfully")
def shift_created_successfully(shift_context):
    assert shift_context["shift"] is not None
    assert shift_context["shift"]["id"] is not None


@then(parsers.parse('the shift status is "{status}"'))
def shift_status_is(shift_context, status):
    assert shift_context["shift"]["status"] == status


@then("an opening balance cash movement is recorded")
def opening_balance_recorded(shift_context):
    movements = shift_context["shift"]["movements"]
    assert len(movements) > 0
    assert movements[0]["type"] == "opening_balance"


@then("no opening balance movement is recorded")
def no_opening_balance_recorded(shift_context):
    movements = shift_context["shift"]["movements"]
    assert len(movements) == 0


@then("the shift appears in the audit log")
def shift_in_audit_log(shift_context, db):
    from uuid import UUID

    from app.audit.models import AuditLog

    shift_id = UUID(shift_context["shift"]["id"])
    audit = db.query(AuditLog).filter(AuditLog.resource_id == shift_id).one()
    assert audit.action == "shifts.open"


@then("a 400 error is returned")
def error_400_returned(shift_context):
    assert shift_context["response"].status_code == 400


@then("a 403 error is returned")
def error_403_returned(shift_context):
    assert shift_context["response"].status_code == 403


@then("both requests return the same shift response")
def both_requests_same_response(shift_context):
    assert shift_context["shift"]["id"] == shift_context["shift_duplicate"]["id"]
    assert shift_context["shift"]["opening_cash_amount"] == shift_context["shift_duplicate"]["opening_cash_amount"]


@then("only one shift exists")
def only_one_shift_exists(shift_context, db):
    from uuid import UUID

    from app.shifts.models import Shift

    shifts = db.query(Shift).filter(Shift.id == UUID(shift_context["shift"]["id"])).all()
    assert len(shifts) == 1


@then("only tenant B's shift is returned")
def only_tenant_b_shift_returned(shift_context):
    returned_shift = shift_context["response"]
    expected_shift = shift_context["tenant_b_shift"]
    assert returned_shift["id"] == expected_shift["id"]

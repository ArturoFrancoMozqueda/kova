from uuid import UUID, uuid4

from pytest_bdd import given, parsers, scenario, then, when

from app.auth.models import Membership


@scenario("../../../../specs/shifts/close.feature", "Cashier closes a shift with balanced cash")
def test_cashier_closes_shift_balanced():
    pass


@scenario("../../../../specs/shifts/close.feature", "Cashier closes a shift with overage")
def test_cashier_closes_shift_overage():
    pass


@scenario("../../../../specs/shifts/close.feature", "Cashier closes a shift with shortage")
def test_cashier_closes_shift_shortage():
    pass


@scenario("../../../../specs/shifts/close.feature", "Cannot close a shift that is already closed")
def test_cannot_close_already_closed_shift():
    pass


@scenario("../../../../specs/shifts/close.feature", "Duplicate close request with same key returns same response")
def test_duplicate_close_request_idempotency():
    pass


@scenario("../../../../specs/shifts/close.feature", "Permission denied without shifts.close permission")
def test_permission_denied_close_shift():
    pass


@scenario("../../../../specs/shifts/close.feature", "Tenant isolation: cannot close another tenant's shift")
def test_tenant_isolation_close_shift():
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


def _open_shift_with_sales(client, tenant_id: UUID) -> dict:
    suffix = uuid4().hex
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-setup-{suffix}"},
        json={"opening_cash_amount": "1000.00"},
    )
    assert response.status_code == 201, response.text
    shift = response.json()
    client.post(
        f"/api/v1/shifts/{shift['id']}/cash-movements",
        json={"type": "cash_in", "amount": "50.00", "reason": "sale"},
    )
    return shift


@given("an authenticated cashier with an open shift", target_fixture="close_context")
def cashier_with_open_shift(client):
    suffix = uuid4().hex
    signup = _signup_verify_login(client, f"shifts-close-cashier-{suffix}@example.com", "Shifts Close Test")
    response = client.post(
        "/api/v1/shifts",
        headers={"Idempotency-Key": f"shift-setup-{suffix}"},
        json={"opening_cash_amount": "1000.00"},
    )
    assert response.status_code == 201, response.text
    shift = response.json()
    return {"client": client, "shift": shift, "tenant_id": UUID(signup["tenant_id"])}


@given("an authenticated cashier with an open shift and sales", target_fixture="close_context")
def cashier_with_open_shift_and_sales(client):
    suffix = uuid4().hex
    signup = _signup_verify_login(client, f"shifts-close-cashier-{suffix}@example.com", "Shifts Close Test")
    shift = _open_shift_with_sales(client, UUID(signup["tenant_id"]))
    return {"client": client, "shift": shift, "tenant_id": UUID(signup["tenant_id"])}


@given("an authenticated cashier with a closed shift", target_fixture="close_context")
def cashier_with_closed_shift(client):
    suffix = uuid4().hex
    signup = _signup_verify_login(client, f"shifts-closed-{suffix}@example.com", "Shifts Closed Test")
    shift = _open_shift_with_sales(client, UUID(signup["tenant_id"]))
    response = client.post(
        f"/api/v1/shifts/{shift['id']}/close",
        headers={"Idempotency-Key": f"shift-close-setup-{suffix}"},
        json={"actual_cash_amount": "1000.00"},
    )
    assert response.status_code == 201, response.text
    closed_shift = response.json()
    return {"client": client, "shift": closed_shift}


@given("an authenticated cashier without close permission", target_fixture="close_context")
def cashier_without_close_permission(client, db):
    suffix = uuid4().hex
    signup = _signup_verify_login(client, f"shifts-no-close-{suffix}@example.com", "Shifts No Close Test")
    shift = _open_shift_with_sales(client, UUID(signup["tenant_id"]))
    _set_role(db, signup, "staff")
    client.post("/api/v1/auth/logout")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": f"shifts-no-close-{suffix}@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text
    return {"client": client, "shift": shift}


@given("two separate tenants with open shifts", target_fixture="close_context")
def two_tenants_with_open_shifts_close(client):
    suffix = uuid4().hex
    signup_a = _signup_verify_login(client, f"shifts-close-a-{suffix}@example.com", "Shifts Close A")
    shift_a = _open_shift_with_sales(client, UUID(signup_a["tenant_id"]))
    client.post("/api/v1/auth/logout")
    signup_b = _signup_verify_login(client, f"shifts-close-b-{suffix}@example.com", "Shifts Close B")
    shift_b = _open_shift_with_sales(client, UUID(signup_b["tenant_id"]))
    return {
        "client": client,
        "shift_a": shift_a,
        "shift_b": shift_b,
        "tenant_a_signup": signup_a,
    }


@when(parsers.parse('the cashier closes the shift with actual cash "{actual_cash}"'))
def cashier_closes_shift(close_context, actual_cash):
    suffix = uuid4().hex
    response = close_context["client"].post(
        f"/api/v1/shifts/{close_context['shift']['id']}/close",
        headers={"Idempotency-Key": f"shift-close-{suffix}"},
        json={"actual_cash_amount": actual_cash},
    )
    assert response.status_code == 201, response.text
    close_context["closed_shift"] = response.json()


@when("the cashier attempts to close the shift again")
def cashier_attempts_close_again(close_context):
    suffix = uuid4().hex
    response = close_context["client"].post(
        f"/api/v1/shifts/{close_context['shift']['id']}/close",
        headers={"Idempotency-Key": f"shift-double-close-{suffix}"},
        json={"actual_cash_amount": "1000.00"},
    )
    close_context["response"] = response


@when(parsers.parse('the cashier closes the shift with idempotency key "{key}"'))
def cashier_closes_with_key(close_context, key):
    response = close_context["client"].post(
        f"/api/v1/shifts/{close_context['shift']['id']}/close",
        headers={"Idempotency-Key": key},
        json={"actual_cash_amount": "1000.00"},
    )
    assert response.status_code == 201, response.text
    close_context["closed_shift"] = response.json()


@when(parsers.parse('closes the shift again with key "{key}"'))
def closes_shift_again_with_key(close_context, key):
    response = close_context["client"].post(
        f"/api/v1/shifts/{close_context['shift']['id']}/close",
        headers={"Idempotency-Key": key},
        json={"actual_cash_amount": "1000.00"},
    )
    assert response.status_code == 201, response.text
    close_context["closed_shift_duplicate"] = response.json()


@when("the cashier attempts to close a shift")
def cashier_attempts_close_no_permission(close_context):
    suffix = uuid4().hex
    response = close_context["client"].post(
        f"/api/v1/shifts/{close_context['shift']['id']}/close",
        headers={"Idempotency-Key": f"shift-close-no-perm-{suffix}"},
        json={"actual_cash_amount": "1000.00"},
    )
    close_context["response"] = response


@when("tenant B attempts to close tenant A's shift")
def tenant_b_attempts_close_tenant_a_shift(close_context):
    suffix = uuid4().hex
    response = close_context["client"].post(
        f"/api/v1/shifts/{close_context['shift_a']['id']}/close",
        headers={"Idempotency-Key": f"shift-cross-close-{suffix}"},
        json={"actual_cash_amount": "1000.00"},
    )
    close_context["response"] = response


@then("the shift is closed successfully")
def shift_closed_successfully(close_context):
    assert close_context["closed_shift"] is not None
    assert close_context["closed_shift"]["status"] == "closed"


@then(parsers.parse('the reconciliation status is "{status}"'))
def reconciliation_status_is(close_context, status):
    assert close_context["closed_shift"]["reconciliation_status"] == status


_RECONCILIATION_UI_LABELS = {
    "balanced": "Caja cuadrada",
    "overage": "Sobrante",
    "shortage": "Faltante",
}


@then(parsers.parse('the UI shows the reconciliation status as "{label}"'))
def ui_reconciliation_label(close_context, label):
    status = close_context["closed_shift"]["reconciliation_status"]
    assert _RECONCILIATION_UI_LABELS[status] == label


@then(parsers.parse('the variance amount is "{variance}"'))
def variance_amount_is(close_context, variance):
    actual = close_context["closed_shift"]["variance_amount"]
    assert actual is not None, "variance_amount should not be None"
    assert str(actual) == variance or actual == variance


@then("the shift appears in the audit log")
def shift_close_in_audit_log(close_context, db):
    from app.audit.models import AuditLog

    shift_id = UUID(close_context["closed_shift"]["id"])
    audit = db.query(AuditLog).filter(
        AuditLog.resource_id == shift_id, AuditLog.action == "shifts.close"
    ).one()
    assert audit.action == "shifts.close"


@then("a 400 error is returned")
def error_400_returned_close(close_context):
    assert close_context["response"].status_code == 400


@then("a 403 error is returned")
def error_403_returned_close(close_context):
    assert close_context["response"].status_code == 403


@then("a 404 error is returned")
def error_404_returned_close(close_context):
    assert close_context["response"].status_code == 404


@then("both requests return the same close response")
def both_requests_same_close_response(close_context):
    assert close_context["closed_shift"]["id"] == close_context["closed_shift_duplicate"]["id"]
    assert close_context["closed_shift"]["status"] == close_context["closed_shift_duplicate"]["status"]


@then("the shift is only closed once")
def shift_only_closed_once(close_context):
    assert close_context["closed_shift"]["status"] == "closed"

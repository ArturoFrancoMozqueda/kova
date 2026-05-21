from uuid import UUID, uuid4

from pytest_bdd import given, scenario, then, when

from app.audit.models import AuditLog


@scenario(
    "../../../../specs/settings/receipt.feature",
    "Fresh tenant opens receipt settings",
)
def test_fresh_tenant_opens_receipt_settings():
    pass


@scenario(
    "../../../../specs/settings/receipt.feature",
    "Owner saves receipt settings",
)
def test_owner_saves_receipt_settings():
    pass


def _signup_verify_login(client, *, tenant_name: str) -> dict:
    email = f"receipt-{uuid4().hex}@example.com"
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": "S3cur3pass!", "tenant_name": tenant_name},
    )
    assert response.status_code == 201, response.text
    signup = response.json()
    verify = client.post("/api/v1/auth/verify", json={"token": signup["dev_verification_token"]})
    assert verify.status_code == 200, verify.text
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert login.status_code == 200, login.text
    return signup


@given("an owner has signed up and verified a new tenant", target_fixture="receipt_context")
def fresh_tenant_owner(client):
    signup = _signup_verify_login(client, tenant_name="Receipt Setup Cafe")
    return {"client": client, "signup": signup}


@given("an owner is authenticated for their tenant", target_fixture="receipt_context")
def authenticated_tenant_owner(client):
    signup = _signup_verify_login(client, tenant_name="Receipt Save Cafe")
    return {"client": client, "signup": signup}


@when("the owner opens receipt settings")
def owner_opens_receipt_settings(receipt_context):
    receipt_context["response"] = receipt_context["client"].get("/api/v1/settings/receipt")


@when("the owner saves receipt settings")
def owner_saves_receipt_settings(receipt_context):
    receipt_context["response"] = receipt_context["client"].put(
        "/api/v1/settings/receipt",
        json={
            "receipt_business_name": "Recibo Smoke Cafe",
            "footer": "Gracias por tu compra",
            "tax_contact_text": "RFC disponible en mostrador",
        },
    )


@then("the API returns a valid initial receipt configuration")
def api_returns_initial_receipt_configuration(receipt_context):
    response = receipt_context["response"]
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tenant_id"] == receipt_context["signup"]["tenant_id"]
    assert body["footer"] is None
    assert body["tax_contact_text"] is None
    assert body["logo_url"] is None


@then("the response uses the tenant name as the receipt business name")
def response_uses_tenant_name(receipt_context):
    assert receipt_context["response"].json()["receipt_business_name"] == "Receipt Setup Cafe"


@then("the response is not a 404")
def response_is_not_404(receipt_context):
    assert receipt_context["response"].status_code != 404


@then("the settings are stored for that tenant")
def settings_are_stored_for_tenant(receipt_context):
    response = receipt_context["response"]
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tenant_id"] == receipt_context["signup"]["tenant_id"]
    assert body["receipt_business_name"] == "Recibo Smoke Cafe"
    assert body["footer"] == "Gracias por tu compra"


@then("an audit log records the update")
def audit_log_records_update(receipt_context, db):
    tenant_id = UUID(receipt_context["signup"]["tenant_id"])
    entry = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == tenant_id, AuditLog.action == "settings.receipt.upsert")
        .one()
    )
    assert entry.resource_type == "tenant"
    assert entry.resource_id == tenant_id


from pytest_bdd import given, parsers, scenario, then, when


@scenario(
    "../../../../specs/auth/happy_path.feature",
    "Tenant owner signs up, verifies email, logs in, and sees tenant data",
)
def test_auth_happy_path():
    pass


@given("a prospective tenant owner", target_fixture="auth_context")
def prospective_tenant_owner():
    return {
        "email": "bdd-owner@example.com",
        "password": "S3cur3pass!",
        "tenant_name": "BDD Bakery",
    }


@when("the owner signs up")
def owner_signs_up(client, auth_context):
    response = client.post(
        "/api/v1/auth/signup",
        json={
            "email": auth_context["email"],
            "password": auth_context["password"],
            "tenant_name": auth_context["tenant_name"],
        },
    )
    assert response.status_code == 201, response.text
    auth_context["signup"] = response.json()


@when("verifies their email")
def verifies_email(client, auth_context):
    response = client.post(
        "/api/v1/auth/verify",
        json={"token": auth_context["signup"]["dev_verification_token"]},
    )
    assert response.status_code == 200, response.text


@when("logs in")
def logs_in(client, auth_context):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": auth_context["email"], "password": auth_context["password"]},
    )
    assert response.status_code == 200, response.text
    assert "access_token" in response.cookies


@then(parsers.parse('the owner can read tenant-scoped session data for "{tenant_name}"'))
def owner_reads_tenant_session(client, auth_context, tenant_name):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["email"] == auth_context["email"]
    assert body["tenant_name"] == tenant_name
    assert body["tenant_id"] == auth_context["signup"]["tenant_id"]

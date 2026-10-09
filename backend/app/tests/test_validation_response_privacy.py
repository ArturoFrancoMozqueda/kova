"""Validation responses must explain errors without reflecting request secrets."""

import pytest


@pytest.mark.parametrize(
    ("path", "body", "sensitive_values", "location", "error_type"),
    [
        (
            "/api/v1/auth/signup",
            {"email": "privacy@example.com", "password": "OnlyLettersSecret", "tenant_name": "Privacy", "accepted_terms": True},
            ["OnlyLettersSecret"], ["body", "password"], "value_error",
        ),
        (
            "/api/v1/auth/password-reset/confirm",
            {"token": "synthetic-reset-token", "new_password": "OnlyLettersSecret"},
            ["synthetic-reset-token", "OnlyLettersSecret"], ["body", "new_password"], "value_error",
        ),
        (
            "/api/v1/auth/login",
            {"email": "privacy@example.com", "password": {"credential": "synthetic-secret"}},
            ["synthetic-secret"], ["body", "password"], "string_type",
        ),
        (
            "/api/v1/auth/signup",
            [{"password": "synthetic-secret", "token": "synthetic-token"}],
            ["synthetic-secret", "synthetic-token"], ["body"], "model_attributes_type",
        ),
        (
            "/api/v1/auth/login",
            {"email": "privacy@example.com", "password": "Synthetic1!", "api_key": "synthetic-api-key"},
            ["synthetic-api-key", "Synthetic1!"], ["body", "api_key"], "extra_forbidden",
        ),
    ],
)
def test_validation_errors_do_not_reflect_sensitive_input(
    client, path, body, sensitive_values, location, error_type
):
    response = client.post(path, json=body)
    assert response.status_code == 422
    # Assert booleans so a regression does not print values in test output.
    assert all(value not in response.text for value in sensitive_values)
    error = response.json()["detail"][0]
    assert error["loc"] == location
    assert error["type"] == error_type
    assert error["msg"]
    assert "input" not in error
    assert "ctx" not in error

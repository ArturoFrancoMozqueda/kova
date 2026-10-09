from datetime import UTC, datetime, timedelta

import pytest

from app.auth import service
from app.auth.models import UserSession
from app.tests.test_auth import signup_and_login


@pytest.mark.parametrize("operation", ["read", "write", "probe"])
def test_expired_session_rejected_with_unexpired_access_cookie(client, db, operation):
    signup_and_login(client)
    payload = service.decode_access_token(client.cookies.get("access_token"))
    session = db.query(UserSession).filter(UserSession.id == payload["jti"]).one()
    session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()

    # The JWT itself is still fresh; the persisted session expiry must also
    # govern access, including writes and the boot-time authenticated probe.
    assert service.decode_access_token(client.cookies.get("access_token"))["jti"]
    if operation == "read":
        assert client.get("/api/v1/auth/me").status_code == 401
    elif operation == "write":
        assert client.post(
            "/api/v1/shifts", json={}, headers={"Idempotency-Key": "expired-session-write"}
        ).status_code == 401
    else:
        response = client.get("/api/v1/auth/session")
        assert response.status_code == 200
        assert response.json()["authenticated"] is False

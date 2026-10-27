from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from sqlalchemy import text

from app.auth.models import Membership
from app.billing.models import Subscription
from app.config import settings
from app.customers.models import Customer
from app.loyalty import cards
from app.loyalty.models import LoyaltyEntry
from app.tenants.models import Tenant
from app.tests.test_loyalty import BASE, key, policy, process, refund, sale, setup

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def issue(client, customer, **kwargs):
    response = client.post(f"{BASE}/customers/{customer}/digital-card", **kwargs)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["share_path"].startswith("/lealtad#")
    return response.json()["share_path"].split("#", 1)[1]


def read(client, token, **kwargs):
    return client.post("/api/v1/public/loyalty/cards", json={"token": token}, **kwargs)


def rewrite(token, **claims):
    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"], audience=cards.AUDIENCE)
    return jwt.encode({**payload, **claims}, settings.secret_key, algorithm="HS256")


def test_card_is_read_only_real_points_projection_without_customer_identity(client, db):
    tenant, customer = setup(client)
    assert policy(client, spend="10", points=2).status_code == 200
    sale(db, tenant, customer, "35")
    assert process(client) == 1
    token = issue(client, customer)
    count = db.query(LoyaltyEntry).count()
    client.cookies.clear()
    response = read(client, token)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {
        "business_name", "branch_name", "balance", "adjustments_pending", "policy",
        "expires_at", "catalog_path", "reward",
    }
    assert body["balance"] == 6
    assert body["adjustments_pending"] is False
    assert body["policy"] == {
        "enabled": True, "spend_amount": "10.00", "points_per_step": 2, "version": 1,
    }
    assert body["catalog_path"] is None
    assert "Cliente lealtad" not in response.text
    assert "5512345678" not in response.text
    assert str(customer) not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert not response.headers.get("set-cookie")
    assert db.query(LoyaltyEntry).count() == count


def test_unconfigured_program_does_not_invent_rates_or_process_purchases(client, db):
    tenant, customer = setup(client)
    sale(db, tenant, customer, "100")
    response = read(client, issue(client, customer))
    assert response.status_code == 200
    assert response.json()["balance"] == 0
    assert response.json()["policy"] == {
        "enabled": False, "spend_amount": None, "points_per_step": None, "version": 0,
    }
    assert db.query(LoyaltyEntry).count() == 0


def test_pending_refund_and_negative_balance_are_preserved(client, db):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    order = sale(db, tenant, customer, "100")
    assert process(client) == 1
    token = issue(client, customer)
    redeemed = client.post(f"{BASE}/customers/{customer}/redeem", headers=key(), json={
        "points": 8, "expected_balance": 10, "benefit": "Beneficio manual", "confirmed": True,
    })
    assert redeemed.status_code == 201
    refund(db, tenant, order, "100")
    pending = read(client, token).json()
    assert pending["balance"] == 2
    assert pending["adjustments_pending"] is True
    assert process(client) == 1
    confirmed = read(client, token).json()
    assert confirmed["balance"] == -8
    assert confirmed["adjustments_pending"] is False


@pytest.mark.parametrize("claim,value", [
    ("aud", "kova-public-catalog"), ("tenant", "not-a-uuid"),
    ("branch", None), ("customer", []), ("issued_by", 123),
    ("revision", None), ("iat", True), ("exp", "9999999999"),
    ("jti", None),
])
def test_invalid_capability_claims_are_unavailable(client, claim, value):
    _, customer = setup(client)
    token = issue(client, customer)
    assert read(client, rewrite(token, **{claim: value})).status_code == 404


def test_invalid_expired_catalog_and_session_tokens_do_not_reach_database(client, monkeypatch):
    _, customer = setup(client)
    token = issue(client, customer)
    now = datetime.now(UTC)
    expired = rewrite(token, iat=now - timedelta(days=31), exp=now - timedelta(days=1))
    too_long_lived = rewrite(token, exp=now + timedelta(days=31))
    missing_exp = jwt.encode({"aud": cards.AUDIENCE}, settings.secret_key, algorithm="HS256")
    altered = token.rsplit(".", 1)[0] + ".invalid-signature"
    from app.loyalty import public_router

    def never_query(*args):
        pytest.fail("An invalid capability must fail before setting a tenant context")

    monkeypatch.setattr(cards, "set_tenant_context", never_query)
    assert public_router.read_card is cards.read_card
    for invalid in (expired, too_long_lived, missing_exp, altered, "a" * 2001):
        result = read(client, invalid)
        assert result.status_code == 404, result.text
        assert result.json() == {"detail": cards.UNAVAILABLE}


@pytest.mark.parametrize("change", ["edited", "inactive", "billing", "tenant", "author"])
def test_current_customer_business_billing_and_author_revoke_access(client, db, change):
    tenant, customer = setup(client)
    token = issue(client, customer)
    if change == "edited":
        db.query(Customer).filter_by(id=customer).one().name = "Nuevo nombre"
    elif change == "inactive":
        db.query(Customer).filter_by(id=customer).one().is_active = False
    elif change == "billing":
        db.add(Subscription(tenant_id=tenant, status="canceled"))
    elif change == "tenant":
        db.query(Tenant).filter_by(id=tenant).one().is_active = False
    else:
        db.query(Membership).filter_by(tenant_id=tenant).one().role = "manager"
    db.commit()
    assert read(client, token).status_code == 404
    if change == "inactive":
        db.query(Customer).filter_by(id=customer).one().is_active = True
        db.commit()
        assert read(client, token).status_code == 404


def test_owner_only_issuer_csrf_customer_and_tenant_gates_remain(client, db):
    tenant, customer = setup(client)
    route = f"{BASE}/customers/{customer}/digital-card"
    assert client.post(route, headers={"X-CSRF-Token": "invalid"}).status_code == 403
    member = db.query(Membership).filter_by(tenant_id=tenant).one()
    for role in ("manager", "cashier"):
        member.role = role
        db.commit()
        assert client.post(route).status_code == 403
    member.role = "owner"
    db.commit()
    assert client.post(f"{BASE}/customers/{uuid4()}/digital-card").status_code == 404
    setup(client)
    assert client.post(route).status_code == 404
    client.cookies.clear()
    assert client.post(route).status_code == 401


def test_card_cannot_authenticate_or_authorize_existing_private_or_catalog_routes(client):
    _, customer = setup(client)
    token = issue(client, customer)
    client.cookies.clear()
    client.cookies.set("access_token", token)
    assert client.get(BASE).status_code == 401
    assert client.get(f"/api/v1/public/catalog/{token}").status_code == 404


def test_branch_balance_is_signed_and_ignores_visitor_scope_headers(client, db):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    sale(db, tenant, customer, "100")
    assert process(client) == 1
    principal = issue(client, customer)
    result = client.post("/api/v1/branches", headers=key(), json={"name": "Otra sucursal"})
    assert result.status_code == 201
    branch_id = result.json()["id"]
    other = issue(client, customer, headers={"X-Kova-Branch": branch_id})
    client.cookies.clear()
    assert read(client, principal, headers={"X-Kova-Branch": branch_id}).json()["balance"] == 10
    assert read(client, other, headers={"X-Kova-Branch": str(tenant)}).json()["balance"] == 0
    assert read(client, other).json()["branch_name"] == "Otra sucursal"


def test_public_projection_works_under_runtime_role_with_rls(client, db, kova_app_engine):
    tenant, customer = setup(client)
    assert policy(client).status_code == 200
    sale(db, tenant, customer, "90")
    assert process(client) == 1
    token = issue(client, customer)
    db.execute(text("SET LOCAL ROLE kova_app"))
    try:
        result = cards.read_card(db, token)
        assert result.balance == 9
        assert db.execute(text("SELECT current_user")).scalar() == "kova_app"
    finally:
        db.execute(text("RESET ROLE"))


def test_card_links_only_the_same_branch_published_catalog(client, db):
    from app.tests.test_customer_orders import _product
    from app.tests.test_storefront import _save

    _, customer = setup(client)
    product = _product(client)
    publication = _save(client, [product])
    assert publication.status_code == 200, publication.text
    token = issue(client, customer)
    assert read(client, token).json()["catalog_path"] == publication.json()["share_path"]
    hidden = _save(client, [product], version=1, enabled=False)
    assert hidden.status_code == 200
    assert read(client, token).json()["catalog_path"] is None

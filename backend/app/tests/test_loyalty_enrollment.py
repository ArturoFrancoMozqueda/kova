from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest

from app.auth.models import Membership
from app.config import settings
from app.customers.models import Customer
from app.loyalty import enrollment
from app.loyalty.models import LoyaltyEntry, LoyaltyMember
from app.storefront.models import PublicCatalog
from app.tests.test_customer_orders import _product
from app.tests.test_loyalty import key, policy, process, sale, setup
from app.tests.test_storefront import _save

pytestmark = pytest.mark.usefixtures("fast_business_auth")
PUBLIC = "/api/v1/public/loyalty/membership"
PRIVATE = "/api/v1/loyalty/enrollment-policy"


def prepare(client, *, enabled=True):
    tenant, old_customer = setup(client)
    assert policy(client).status_code == 200
    product = _product(client)
    response = _save(client, [product])
    assert response.status_code == 200, response.text
    menu = response.json()["share_path"].split("/")[-1]
    assert client.get(PRIVATE).json() == {"enabled": False, "version": 0}
    if enabled:
        response = client.put(PRIVATE, headers=key(), json={"enabled": True, "expected_version": 0})
        assert response.status_code == 200, response.text
    return tenant, old_customer, menu


def bootstrap(client, menu, **kwargs):
    response = client.get(PUBLIC, params={"menu": menu}, **kwargs)
    assert response.status_code == 200, response.text
    return response


def join(client, menu, context, operation=None, name="Mariana", **extra):
    headers = {
        "Idempotency-Key": operation or str(uuid4()),
        "X-Kova-Member-CSRF": context["csrf_token"],
        **extra,
    }
    return client.post(
        PUBLIC + "/enroll",
        json={"menu_token": menu, "name": name, "confirmed": True},
        headers=headers,
    )


def test_opt_in_and_visit_create_no_customer_or_points(client, db):
    _, _, menu = prepare(client, enabled=False)
    before = db.query(Customer).count()
    client.cookies.clear()
    response = bootstrap(client, menu)
    assert response.json()["available"] is False
    assert response.json()["enrolled"] is False
    assert response.json()["csrf_token"] is None
    assert "set-cookie" not in response.headers
    assert db.query(Customer).count() == before
    assert db.query(LoyaltyEntry).count() == 0


def test_public_enrollment_real_balance_and_private_code_lookup(client, db):
    tenant, old_customer, menu = prepare(client)
    merchant_cookies = list(client.cookies.jar)
    client.cookies.clear()
    before = db.query(Customer).count()
    response = bootstrap(client, menu)
    assert response.json()["available"] is True
    assert db.query(Customer).count() == before
    cookie = response.headers["set-cookie"]
    assert (
        "HttpOnly" in cookie
        and "SameSite=strict" in cookie
        and "Path=/api/v1/public/loyalty" in cookie
    )
    result = join(client, menu, response.json(), name="Cliente lealtad")
    assert result.status_code == 201, result.text
    card = result.json()["card"]
    assert card["balance"] == 0
    assert card["member_qr_data_url"].startswith("data:image/png;base64,")
    member = db.query(LoyaltyMember).one()
    assert member.customer_id != old_customer
    customer = db.get(Customer, member.customer_id)
    assert customer.phone is None and customer.email is None
    sale(db, tenant, customer.id, "50")
    for item in merchant_cookies:
        client.cookies.jar.set_cookie(item)
    assert process(client) == 1
    resolve = client.post(
        "/api/v1/loyalty/members/resolve",
        json={"code": card["member_code"].lower().replace("-", " ")},
    )
    assert resolve.status_code == 200, resolve.text
    assert resolve.json()["customer"]["id"] == str(member.customer_id)
    refreshed = bootstrap(client, menu).json()["card"]
    assert refreshed["balance"] == 5
    assert "phone" not in refreshed and "customer_id" not in refreshed


def test_bootstrap_replay_requires_operation_and_cookie_rotates(client, db):
    _, _, menu = prepare(client)
    client.cookies.clear()
    context = bootstrap(client, menu).json()
    pre = list(client.cookies.jar)
    operation = str(uuid4())
    first = join(client, menu, context, operation)
    assert first.status_code == 201, first.text
    member = db.query(LoyaltyMember).one()
    client.cookies.clear()
    for item in pre:
        client.cookies.jar.set_cookie(item)
    assert client.get(PUBLIC, params={"menu": menu}).status_code == 409
    replay = client.get(PUBLIC, params={"menu": menu}, headers={"Idempotency-Key": operation})
    assert replay.status_code == 200, replay.text
    assert replay.json()["card"]["member_code"] == member.code
    assert list(client.cookies.jar)[0].value != pre[0].value
    again = join(client, menu, context, operation)
    assert again.status_code == 201, again.text
    assert db.query(LoyaltyMember).count() == 1
    assert join(client, menu, context, operation, name="Otro").status_code == 409
    assert client.get(PUBLIC, params={"menu": menu}, headers=key()).status_code == 409


def test_cookie_less_same_key_cannot_duplicate_committed_customer(client, db):
    _, _, menu = prepare(client)
    client.cookies.clear()
    initial = bootstrap(client, menu).json()
    operation = str(uuid4())
    assert join(client, menu, initial, operation).status_code == 201
    count = db.query(Customer).count()
    client.cookies.clear()
    assert (
        client.get(
            PUBLIC, params={"menu": menu}, headers={"Idempotency-Key": operation}
        ).status_code
        == 409
    )
    other = bootstrap(client, menu).json()
    assert join(client, menu, other, operation).status_code == 409
    assert db.query(Customer).count() == count


def test_paused_enrollment_and_unpublished_menu_keep_existing_card(client, db):
    tenant, _, menu = prepare(client)
    merchant = list(client.cookies.jar)
    client.cookies.clear()
    assert join(client, menu, bootstrap(client, menu).json()).status_code == 201
    member_cookies = list(client.cookies.jar)
    for item in merchant:
        client.cookies.jar.set_cookie(item)
    response = client.put(PRIVATE, headers=key(), json={"enabled": False, "expected_version": 1})
    assert response.status_code == 200
    row = db.query(PublicCatalog).filter_by(tenant_id=tenant).one()
    row.enabled = False
    db.commit()
    client.cookies.clear()
    for item in member_cookies:
        client.cookies.jar.set_cookie(item)
    result = bootstrap(client, menu).json()
    assert result["enrolled"] is True and result["available"] is False
    assert result["card"]["catalog_path"] is None
    client.cookies.clear()
    assert client.get(PUBLIC, params={"menu": menu}).status_code == 404


@pytest.mark.parametrize("mutation", ["customer", "reactivation", "author", "expiry"])
def test_revoked_members_never_replay_balance(client, db, mutation):
    tenant, _, menu = prepare(client)
    client.cookies.clear()
    initial = bootstrap(client, menu).json()
    operation = str(uuid4())
    assert join(client, menu, initial, operation).status_code == 201
    member = db.query(LoyaltyMember).one()
    if mutation in {"customer", "reactivation"}:
        customer = db.get(Customer, member.customer_id)
        customer.is_active = mutation == "reactivation"
        customer.updated_at = datetime.now(UTC) + timedelta(seconds=1)
    elif mutation == "author":
        db.query(Membership).filter_by(tenant_id=tenant).one().is_active = False
    else:
        member.created_at = datetime.now(UTC) - timedelta(days=181)
        member.expires_at = datetime.now(UTC) - timedelta(days=1)
    db.commit()
    assert (
        client.get(
            PUBLIC, params={"menu": menu}, headers={"Idempotency-Key": operation}
        ).status_code
        == 404
    )
    assert join(client, menu, initial, operation).status_code == 404


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.test"},
        {"Origin": "null", "Referer": settings.frontend_url},
        {"X-Kova-Member-CSRF": "bad"},
    ],
)
def test_public_write_rejects_forgery_without_customer_creation(client, db, headers):
    _, _, menu = prepare(client)
    client.cookies.clear()
    context = bootstrap(client, menu).json()
    before = db.query(Customer).count()
    assert join(client, menu, context, **headers).status_code == 403
    assert db.query(Customer).count() == before


def test_expired_or_wrong_audience_cookie_cannot_enroll(client, db):
    _, _, menu = prepare(client)
    client.cookies.clear()
    context = bootstrap(client, menu).json()
    cookie = list(client.cookies.jar)[0]
    payload = jwt.decode(
        cookie.value, settings.secret_key, algorithms=["HS256"], audience=enrollment.AUDIENCE
    )
    payload.update(
        iat=datetime.now(UTC) - timedelta(hours=1), exp=datetime.now(UTC) - timedelta(minutes=1)
    )
    client.cookies.set(
        cookie.name,
        jwt.encode(payload, settings.secret_key, algorithm="HS256"),
        path=enrollment.COOKIE_PATH,
    )
    assert join(client, menu, context).status_code == 403
    assert db.query(LoyaltyMember).count() == 0


def test_merchant_cookie_still_requires_merchant_csrf(client, db):
    _, _, menu = prepare(client)
    context = bootstrap(client, menu).json()
    client._disable_auto_csrf = True
    try:
        response = join(client, menu, context, Origin=settings.frontend_url, **{"X-CSRF-Token": ""})
        assert response.status_code == 403, response.text
        assert db.query(LoyaltyMember).count() == 0
        response = join(
            client,
            menu,
            context,
            Origin=settings.frontend_url,
            **{"X-CSRF-Token": client.cookies.get("csrf_token")},
        )
        assert response.status_code == 201, response.text
    finally:
        client._disable_auto_csrf = False


def test_bootstrap_racing_pages_share_no_customer_and_forged_cookie_is_replaced(client, db):
    _, _, menu = prepare(client)
    client.cookies.clear()
    before = db.query(Customer).count()
    first = bootstrap(client, menu).json()
    cookie = list(client.cookies.jar)[0]
    repeated = bootstrap(client, menu).json()
    assert list(client.cookies.jar)[0].value == cookie.value
    assert join(client, menu, first).status_code == 201
    assert db.query(Customer).count() == before + 1
    assert join(client, menu, repeated).status_code == 403
    assert join(client, menu, bootstrap(client, menu).json()).status_code == 409
    client.cookies.clear()
    client.cookies.set(
        cookie.name, "untrusted-fixed-cookie", domain=cookie.domain, path=enrollment.COOKIE_PATH
    )
    fresh = bootstrap(client, menu)
    assert fresh.json()["enrolled"] is False
    assert "set-cookie" in fresh.headers
    assert list(client.cookies.jar)[0].value != "untrusted-fixed-cookie"


def test_export_excludes_device_secrets_and_purge_removes_members(client, db):
    import csv
    import io
    import zipfile

    from app.account_lifecycle.models import AccountDeletionRequest
    from app.account_lifecycle.service import purge_due_accounts
    from app.loyalty.models import LoyaltyEnrollmentPolicy

    tenant, _, menu = prepare(client)
    merchant = list(client.cookies.jar)
    client.cookies.clear()
    assert join(client, menu, bootstrap(client, menu).json()).status_code == 201
    member = db.query(LoyaltyMember).one()
    hashes = [
        member.credential_hash,
        member.bootstrap_hash,
        member.operation_hash,
        member.request_hash,
    ]
    for item in merchant:
        client.cookies.jar.set_cookie(item)
    response = client.get("/api/v1/export/account")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        rows = list(csv.DictReader(io.StringIO(archive.read("datos/loyalty_members.csv").decode())))
        assert rows[0]["id"] == str(member.id)
        assert rows[0]["code"] == member.code
        rendered = "".join(
            archive.read(name).decode(errors="replace") for name in archive.namelist()
        )
        assert not any(value in rendered for value in hashes)
        assert not any(
            name in rows[0]
            for name in ("credential_hash", "bootstrap_hash", "operation_hash", "request_hash")
        )
    owner = db.query(Membership).filter_by(tenant_id=tenant, role="owner").one()
    db.add(
        AccountDeletionRequest(
            tenant_id=tenant,
            requested_by_user_id=owner.user_id,
            purge_after=datetime.now(UTC) - timedelta(minutes=1),
        )
    )
    db.commit()
    assert purge_due_accounts(db) == 1
    assert db.query(LoyaltyMember).filter_by(tenant_id=tenant).count() == 0
    assert db.query(LoyaltyEnrollmentPolicy).filter_by(tenant_id=tenant).count() == 0


from app.tests.test_loyalty_rewards import committed_reward  # noqa: E402,F401


@pytest.fixture
def committed_program(owner_engine, committed_reward):  # noqa: F811
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from app.loyalty.models import LoyaltyEnrollmentPolicy

    tenant, _, _, _ = committed_reward
    catalog_id = uuid4()
    with Session(owner_engine) as db:
        db.add(
            PublicCatalog(
                id=catalog_id, tenant_id=tenant, branch_id=tenant, title="Menú", enabled=True
            )
        )
        db.add(
            LoyaltyEnrollmentPolicy(
                tenant_id=tenant,
                branch_id=tenant,
                version=1,
                enabled=True,
                authorized_by_user_id=tenant,
            )
        )
        db.commit()
    yield tenant, catalog_id
    with owner_engine.begin() as conn:
        for table in ("loyalty_members", "loyalty_enrollment_policies", "public_catalogs"):
            conn.execute(text(f"DELETE FROM {table} WHERE tenant_id=:id"), {"id": tenant})


@pytest.mark.parametrize("same_key", [True, False])
def test_runtime_concurrent_enrollment_one_profile_no_points(
    kova_app_engine, committed_program, same_key
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from fastapi import HTTPException, Request, Response
    from sqlalchemy.orm import Session

    from app.branches.scope import bind_branch
    from app.db import set_tenant_context
    from app.loyalty.schemas import PublicEnrollmentWrite

    tenant, catalog_id = committed_program
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        catalog = db.get(PublicCatalog, catalog_id)
        now = datetime.now(UTC).replace(microsecond=0)
        token = enrollment._encode(
            catalog, "bootstrap", "a" * 64, now, now + enrollment.BOOTSTRAP_TTL
        )
        grant = enrollment._grant(catalog, token)
        name = enrollment.cookie_name(catalog)
    barrier = Barrier(2)
    operation = str(uuid4())

    def apply(index):
        with Session(kova_app_engine) as db:
            set_tenant_context(db, tenant)
            bind_branch(db, tenant_id=tenant)
            catalog = db.get(PublicCatalog, catalog_id)
            request = Request(
                {"type": "http", "headers": [(b"cookie", f"{name}={token}".encode())]}
            )
            body = PublicEnrollmentWrite(menu_token="public-program", name="Ana", confirmed=True)
            barrier.wait(timeout=10)
            try:
                result = enrollment.enroll(
                    db,
                    catalog,
                    request,
                    Response(),
                    body,
                    operation if same_key else f"{operation}-{index}",
                    grant,
                )
                return 201, result["card"].member_code
            except HTTPException as exc:
                db.rollback()
                return exc.status_code, None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(apply, range(2)))
    assert sorted(status for status, _ in results) == ([201, 201] if same_key else [201, 409])
    if same_key:
        assert results[0][1] == results[1][1]
    with Session(kova_app_engine) as db:
        set_tenant_context(db, tenant)
        bind_branch(db, tenant_id=tenant)
        assert db.query(LoyaltyMember).count() == 1
        assert db.query(Customer).count() == 2
        assert db.query(LoyaltyEntry).count() == 0


def test_public_policy_disabled_when_points_author_revoked_but_card_author_valid(client, db):
    from sqlalchemy import text

    from app.loyalty.models import LoyaltyPolicyRevision
    from app.tests.test_loyalty_cards import issue, read

    tenant, customer, menu = prepare(client)
    old_token = issue(client, customer)
    owner_b = uuid4()
    db.execute(
        text(
            "INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES(:id,:email,'test-only',true)"
        ),
        {"id": owner_b, "email": f"policy-{owner_b}@example.com"},
    )
    db.add(
        Membership(
            tenant_id=tenant,
            user_id=owner_b,
            role="owner",
            is_active=True,
            created_at=datetime.now(UTC),
        )
    )
    revision = db.query(LoyaltyPolicyRevision).filter_by(tenant_id=tenant).one()
    revision.authorized_by_user_id = owner_b
    db.commit()
    client.cookies.clear()
    assert join(client, menu, bootstrap(client, menu).json()).status_code == 201
    db.query(Membership).filter_by(tenant_id=tenant, user_id=owner_b).one().is_active = False
    db.commit()
    context = bootstrap(client, menu).json()
    assert context["enrolled"] is True and context["available"] is False
    for projection in (
        context["policy"],
        context["card"]["policy"],
        read(client, old_token).json()["policy"],
    ):
        assert projection["enabled"] is False
        assert projection["spend_amount"] == "10.00"

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.auth import repository as auth_repository
from app.auth.models import Membership
from app.billing.models import Subscription
from app.branches.scope import bind_branch
from app.business_settings.models import BusinessProfile
from app.reports import dashboard
from app.shifts.models import Shift
from app.tests.test_catalog import _signup_verify_login
from app.tests.test_orders import _create_cash_order, _create_product, _open_shift

pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _owner(client):
    return _signup_verify_login(client, f"overview-{uuid4().hex}@example.com", "Panel real")


def _overview(client, **kwargs):
    response = client.get("/api/v1/reports/dashboard", **kwargs)
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["Cache-Control"]
    return response.json()


def test_overview_reuses_real_reports_and_stock_with_one_session_check(client, db, monkeypatch):
    signup = _owner(client)
    _open_shift(client)
    product = _create_product(client, track_inventory=True)
    adjustment = client.post(
        f"/api/v1/inventory/products/{product['id']}/adjustments",
        headers={"Idempotency-Key": str(uuid4())},
        json={"quantity_delta": 10, "reason": "Inventario inicial de prueba"},
    )
    assert adjustment.status_code == 201, adjustment.text
    order = _create_cash_order(client, product["id"])
    assert order.status_code == 201, order.text
    refund = client.post(
        f"/api/v1/orders/{order.json()['id']}/refunds",
        headers={"Idempotency-Key": str(uuid4())},
        json={"reason": "customer_return", "refund_payment_method": "cash",
              "items": [{"order_item_id": order.json()["items"][0]["id"], "quantity": 1}]},
    )
    assert refund.status_code == 201, refund.text
    threshold = client.patch(
        f"/api/v1/inventory/products/{product['id']}/low-stock-threshold",
        headers={"Idempotency-Key": str(uuid4())}, json={"low_stock_threshold": 10},
    )
    assert threshold.status_code == 200, threshold.text
    _create_product(client, name="Sin seguimiento")
    archived = _create_product(client, name="Archivado", track_inventory=True)
    deleted = client.delete(f"/api/v1/catalog/products/{archived['id']}",
                            headers={"Idempotency-Key": str(uuid4())})
    assert deleted.status_code == 200, deleted.text
    checks = []
    original = auth_repository.get_session_by_id

    def checked(*args, **kwargs):
        checks.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(auth_repository, "get_session_by_id", checked)
    data = _overview(client)
    assert len(checks) == 1
    assert data["active_catalog_count"] == 2
    assert data["tracked_inventory_count"] == 1
    assert data["active_employee_count"] == 1
    assert data["onboarding"]["tenant_id"] == signup["tenant_id"]
    dates = {key: data["story"]["summary"][key] for key in ("start_date", "end_date")}
    assert data["story"] == client.get("/api/v1/reports/business-story", params=dates).json()
    assert data["hourly"] == client.get("/api/v1/reports/sales-by-hour", params=dates).json()
    assert data["previous_summary"] == client.get(
        "/api/v1/reports/sales-summary",
        params={key: data["previous_summary"][key] for key in ("start_date", "end_date")},
    ).json()
    assert data["low_stock_items"] == client.get("/api/v1/inventory/low-stock").json()
    assert [item["product_id"] for item in data["low_stock_items"]] == [product["id"]]
    assert data["story"]["summary"]["refund_count"] == 1


@pytest.mark.parametrize("period,days", [("day", 1), ("week", 7), ("month", 30)])
@pytest.mark.parametrize("timezone,day", [("America/Mexico_City", "2026-10-08"),
                                         ("America/Tijuana", "2026-10-07")])
def test_periods_use_the_tenant_day_and_equal_previous_ranges(
    client, db, monkeypatch, period, days, timezone, day,
):
    signup = _owner(client)
    profile = db.get(BusinessProfile, UUID(signup["tenant_id"]))
    if profile is None:
        profile = BusinessProfile(tenant_id=UUID(signup["tenant_id"]), public_name="Panel")
        db.add(profile)
    profile.timezone = timezone
    db.commit()

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 10, 8, 6, 30, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(dashboard, "datetime", Clock)
    data = _overview(client, params={"period": period})
    end = datetime.fromisoformat(day).date()
    start = end - timedelta(days=days - 1)
    assert data["timezone"] == timezone
    assert data["story"]["summary"]["end_date"] == day
    assert data["story"]["summary"]["start_date"] == start.isoformat()
    assert data["previous_summary"]["end_date"] == (start - timedelta(days=1)).isoformat()
    assert data["previous_summary"]["start_date"] == (start - timedelta(days=days)).isoformat()


@pytest.mark.parametrize("role,status", [("manager", 200), ("cashier", 403), ("staff", 403)])
def test_role_permissions_are_preserved(client, db, role, status):
    signup = _owner(client)
    membership = db.query(Membership).filter(
        Membership.tenant_id == UUID(signup["tenant_id"]),
        Membership.user_id == UUID(signup["user_id"]),
    ).one()
    membership.role = role
    db.commit()
    response = client.get("/api/v1/reports/dashboard")
    assert response.status_code == status, response.text
    if status == 200:
        assert response.json()["billing"] is None
        assert response.json()["active_employee_count"] is None


def test_auth_and_billing_gates_reject_before_overview(client, db, monkeypatch):
    assert client.get("/api/v1/reports/dashboard").status_code == 401
    signup = _owner(client)
    db.add(Subscription(tenant_id=UUID(signup["tenant_id"]), status="canceled"))
    db.commit()

    def forbidden_overview(*args, **kwargs):
        pytest.fail("denied request must not read dashboard data")

    monkeypatch.setattr("app.reports.router.overview", forbidden_overview)
    assert client.get("/api/v1/reports/dashboard").status_code == 402


def test_tenants_and_selected_branch_are_isolated_without_shift_reconciliation(client, db, monkeypatch):
    first = _owner(client)
    _create_product(client)
    assert _overview(client)["active_catalog_count"] == 1
    client.cookies.clear()
    second = _owner(client)
    assert _overview(client)["active_catalog_count"] == 0
    created = client.post("/api/v1/branches", json={"name": "Centro"},
                          headers={"Idempotency-Key": str(uuid4())})
    assert created.status_code == 201, created.text
    tenant = UUID(second["tenant_id"])
    branch = UUID(created.json()["id"])
    for branch_id, count in [(tenant, 51), (branch, 2), (UUID(first["tenant_id"]), 3)]:
        owner_tenant = UUID(first["tenant_id"]) if count == 3 else tenant
        bind_branch(db, tenant_id=owner_tenant, branch_id=branch_id)
        db.add_all(Shift(tenant_id=owner_tenant, branch_id=branch_id, status="closed",
                         closed_at=datetime.now(UTC)) for _ in range(count))
        db.commit()

    def expensive(*args, **kwargs):
        pytest.fail("overview counts shifts without hydrating drawer finances")

    monkeypatch.setattr("app.shifts.service._shift_body", expensive)
    assert _overview(client)["closed_shift_count"] == 50
    other_branch = _overview(client, headers={"X-Kova-Branch": str(branch)})
    assert other_branch["closed_shift_count"] == 2
    assert other_branch["onboarding"]["tenant_id"] == str(tenant)
    assert client.get("/api/v1/reports/dashboard", params={"period": "year"}).status_code == 422

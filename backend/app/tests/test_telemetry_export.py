import csv
import io
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.billing.models import Subscription, WebhookEvent
from app.config import settings
from app.orders.models import Order
from app.telemetry.export import summarize_analysis_adoption
from app.telemetry.models import TelemetryEvent
from app.telemetry.schemas import AnalysisAdoptionReport

# Password cost is incidental to these business scenarios; real auth routes stay active.
pytestmark = pytest.mark.usefixtures("fast_business_auth")


def _signup_and_login(client) -> None:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "cro-export@example.com",
            "password": "S3cur3pass!",
            "tenant_name": "Negocio CRO",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    token = signup.json()["dev_verification_token"]
    assert client.post("/api/v1/auth/verify", json={"token": token}).status_code == 200
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "cro-export@example.com", "password": "S3cur3pass!"},
    )
    assert login.status_code == 200, login.text


def test_cro_export_requires_internal_key(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_api_key", "cro-secret")
    assert client.get("/api/v1/telemetry/internal/cro-export").status_code == 403
    assert (
        client.get(
            "/api/v1/telemetry/internal/cro-export",
            headers={"X-Internal-Key": "wrong"},
        ).status_code
        == 403
    )


def test_growth_snapshot_uses_real_business_tables(client, db, monkeypatch):
    monkeypatch.setattr(settings, "internal_api_key", "growth-secret")
    url = "/api/v1/telemetry/internal/growth-snapshot"

    assert client.get(url).status_code == 403
    baseline_response = client.get(url, headers={"X-Internal-Key": "growth-secret"})
    assert baseline_response.status_code == 200, baseline_response.text
    baseline = baseline_response.json()

    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": "growth-truth@example.com",
            "password": "S3cur3pass!",
            "tenant_name": "Negocio Growth Truth",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    signup_body = signup.json()
    tenant_id = signup_body["tenant_id"]
    assert client.post(
        "/api/v1/auth/verify",
        json={"token": signup_body["dev_verification_token"]},
    ).status_code == 200

    db.add(
        Order(
            tenant_id=tenant_id,
            status="completed",
            subtotal_amount=Decimal("100.00"),
            total_amount=Decimal("100.00"),
        )
    )
    db.add(
        Subscription(
            tenant_id=tenant_id,
            stripe_subscription_id="sub_growth_truth",
            status="active",
        )
    )
    db.flush()

    active_without_payment = client.get(
        url, headers={"X-Internal-Key": "growth-secret"}
    ).json()
    assert active_without_payment["paying_tenants"] == baseline["paying_tenants"]

    db.add(
        WebhookEvent(
            tenant_id=tenant_id,
            stripe_event_id="evt_growth_test_payment",
            event_type="invoice.payment_succeeded",
            processing_status="processed",
            payload={"livemode": False},
        )
    )
    db.flush()
    test_payment = client.get(
        url, headers={"X-Internal-Key": "growth-secret"}
    ).json()
    assert test_payment["paying_tenants"] == baseline["paying_tenants"]

    db.add(
        WebhookEvent(
            tenant_id=tenant_id,
            stripe_event_id="evt_growth_live_payment",
            event_type="invoice.paid",
            processing_status="processed",
            payload={"livemode": True},
        )
    )
    db.flush()

    response = client.get(url, headers={"X-Internal-Key": "growth-secret"})
    assert response.status_code == 200, response.text
    snapshot = response.json()
    assert snapshot["users_created"] == baseline["users_created"] + 1
    assert snapshot["users_verified"] == baseline["users_verified"] + 1
    assert (
        snapshot["tenants_with_completed_sale"]
        == baseline["tenants_with_completed_sale"] + 1
    )
    assert snapshot["paying_tenants"] == baseline["paying_tenants"] + 1
    assert set(snapshot) == {
        "generated_at",
        "users_created",
        "users_verified",
        "tenants_with_completed_sale",
        "paying_tenants",
    }


def test_cro_export_joins_anonymous_and_authenticated_by_client_id(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_api_key", "cro-secret")
    client_id = "cro-client-123"
    common = {
        "device_class": "mobile",
        "viewport_bucket": "mobile_390",
        "source": "google",
        "medium": "cpc",
        "campaign": "julio-pos",
    }
    anonymous = client.post(
        "/api/v1/telemetry/events/anonymous",
        json={
            # `signup_completed` is server-authored now (see
            # test_telemetry_origin_guard), so the client-side rung the export
            # has to stitch is signup_started.
            "event_name": "signup_started",
            "client_event_id": "signup_started:export",
            "client_id": client_id,
            "properties": {**common, "path": "/signup", "cta": "hero"},
        },
        headers={
            "X-Kova-Anonymous-Token": client.post(
                "/api/v1/telemetry/events/anonymous/session",
                json={"client_id": client_id},
            ).json()["token"]
        },
    )
    assert anonymous.status_code == 202, anonymous.text

    _signup_and_login(client)
    authenticated = client.post(
        "/api/v1/telemetry/events",
        json={
            "event_name": "first_sale_completed",
            "client_event_id": "first_sale_completed:export",
            "properties": {**common, "client_id": client_id, "path": "/register"},
        },
    )
    assert authenticated.status_code == 202, authenticated.text

    response = client.get(
        "/api/v1/telemetry/internal/cro-export",
        headers={"X-Internal-Key": "cro-secret"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    client_rows = [row for row in rows if row["client_id"] == client_id]
    assert {row["event"] for row in client_rows} == {
        "signup_started",
        "first_sale_completed",
    }
    assert {row["conversion_state"] for row in client_rows} == {"activated"}
    assert {row["device_class"] for row in client_rows} == {"mobile"}
    assert "tenant_id" not in rows[0]
    assert "user_id" not in rows[0]
    assert "total_amount" not in rows[0]


def test_analysis_adoption_is_tenant_aggregated_and_requires_internal_key(client, monkeypatch):
    monkeypatch.setattr(settings, "internal_api_key", "cro-secret")
    _signup_and_login(client)
    baseline_response = client.get(
        "/api/v1/telemetry/internal/analysis-adoption?days=7",
        headers={"X-Internal-Key": "cro-secret"},
    )
    assert baseline_response.status_code == 200, baseline_response.text
    baseline = baseline_response.json()
    common = {
        "client_id": "analysis-client-123",
        "path": "/reports",
        "device_class": "desktop",
        "viewport_bucket": "desktop",
        "source": "direct",
        "medium": "none",
        "campaign": "not_set",
    }
    events = [
        (
            "analysis_viewed",
            {
                **common,
                "range_days": 7,
                "preset": "seven_days",
                "has_previous_period": True,
                "recommendation_count": 2,
            },
        ),
        (
            "analysis_action_completed",
            {
                **common,
                "template_id": "R2",
                "decision_area": "inventario",
                "priority": "alta",
                "surface": "prioridad",
            },
        ),
        (
            "analysis_action_feedback",
            {
                **common,
                "template_id": "R2",
                "decision_area": "inventario",
                "priority": "alta",
                "surface": "prioridad",
                "helpfulness": "helpful",
            },
        ),
    ]
    for index, (name, properties) in enumerate(events):
        response = client.post(
            "/api/v1/telemetry/events",
            json={
                "event_name": name,
                "client_event_id": f"analysis-export-{index}",
                "properties": properties,
            },
        )
        assert response.status_code == 202, response.text

    assert client.get("/api/v1/telemetry/internal/analysis-adoption").status_code == 403
    assert (
        client.get(
            "/api/v1/telemetry/internal/analysis-adoption?days=7",
            headers={"X-Internal-Key": "wrong"},
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/v1/telemetry/internal/analysis-adoption?days=14",
            headers={"X-Internal-Key": "cro-secret"},
        ).status_code
        == 422
    )
    assert (
        client.get(
            "/api/v1/telemetry/internal/analysis-adoption?days=30",
            headers={"X-Internal-Key": "cro-secret"},
        ).status_code
        == 200
    )
    report_response = client.get(
        "/api/v1/telemetry/internal/analysis-adoption?days=7",
        headers={"X-Internal-Key": "cro-secret"},
    )
    assert report_response.status_code == 200, report_response.text
    report = report_response.json()
    expected_viewed = baseline["tenants"]["viewed"] + 1
    expected_completed = baseline["tenants"]["completed_action"] + 1
    expected_helpful = baseline["tenants"]["helpful_action"] + 1
    assert report["tenants"]["viewed"] == expected_viewed
    assert report["tenants"]["completed_action"] == expected_completed
    assert report["tenants"]["helpful_action"] == expected_helpful
    assert report["rates"]["viewer_completion_rate"] == round(expected_completed / expected_viewed, 4)
    assert report["rates"]["viewer_helpful_rate"] == round(expected_helpful / expected_viewed, 4)
    assert report["completed_decision_areas"]["inventario"] == (
        baseline["completed_decision_areas"].get("inventario", 0) + 1
    )
    assert "tenant_id" not in report_response.text
    assert "user_id" not in report_response.text


def test_analysis_event_retry_is_idempotent_and_tenant_is_session_derived(client, db) -> None:
    _signup_and_login(client)
    payload = {
        "event_name": "analysis_viewed",
        "client_event_id": "analysis-idempotent-view",
        "properties": {
            "range_days": 7,
            "preset": "seven_days",
            "has_previous_period": True,
            "recommendation_count": 2,
        },
    }

    assert client.post("/api/v1/telemetry/events", json=payload).status_code == 202
    assert client.post("/api/v1/telemetry/events", json=payload).status_code == 202
    stored = db.scalar(
        select(func.count())
        .select_from(TelemetryEvent)
        .where(TelemetryEvent.client_event_id == "analysis-idempotent-view")
    )
    assert stored == 1

    injected = {**payload, "client_event_id": "analysis-injected-tenant", "tenant_id": "other"}
    assert client.post("/api/v1/telemetry/events", json=injected).status_code == 422


def test_analysis_summary_covers_active_adoption_retention_and_ordered_journey() -> None:
    now = datetime(2026, 8, 4, 12, tzinfo=UTC)

    def event(tenant_id: str, name: str, ago: float, **properties):
        return SimpleNamespace(
            tenant_id=tenant_id,
            event_name=name,
            created_at=now - timedelta(days=ago),
            properties=properties,
        )

    events = [
        event("t1", "analysis_viewed", 10),
        event("t1", "analysis_viewed", 2),
        event("t1", "analysis_action_completed", 1.5, decision_area="inventario"),
        event(
            "t1",
            "analysis_action_feedback",
            1.4,
            decision_area="inventario",
            helpfulness="helpful",
        ),
        event("t2", "analysis_viewed", 2),
        event("t2", "analysis_action_completed", 1.5, decision_area="caja"),
        event(
            "t2",
            "analysis_action_feedback",
            1.4,
            decision_area="caja",
            helpfulness="not_yet",
        ),
        event(
            "t3",
            "analysis_action_feedback",
            1,
            decision_area="margen",
            helpfulness="helpful",
        ),
    ]
    report = summarize_analysis_adoption(
        events,
        [("t1", now - timedelta(days=3)), ("t2", now - timedelta(days=3)), ("t4", now - timedelta(days=3))],
        [("t1", now - timedelta(days=2.5)), ("t2", now - timedelta(days=1)), ("t4", now - timedelta(days=2))],
        days=7,
        now=now,
    )
    AnalysisAdoptionReport.model_validate(report)

    assert report["tenants"] == {
        "active": 3,
        "viewed": 2,
        "active_viewed": 2,
        "completed_action": 2,
        "helpful_action": 1,
        "not_yet_action": 1,
        "active_completed_action": 2,
        "active_helpful_action": 1,
    }
    assert report["rates"] == {
        "active_view_rate": 0.6667,
        "viewer_completion_rate": 1.0,
        "viewer_helpful_rate": 0.5,
        "active_completion_rate": 0.6667,
        "active_helpful_rate": 0.3333,
    }
    assert report["retention"] == {
        "previous_viewed": 1,
        "returning_viewed": 1,
        "return_rate": 1.0,
    }
    assert report["journey"] == {
        "sold": 3,
        "closed_shift": 3,
        "sale_close_analysis": 1,
        "sale_close_analysis_rate": 0.3333,
    }
    assert report["completed_decision_areas"] == {"caja": 1, "inventario": 1}
    assert "tenant_id" not in str(report)

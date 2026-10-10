from copy import deepcopy
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.reports import router
from app.reports.service import _executive_summary, _recommended_actions


def _engine_story(method: str, count: int = 5) -> dict:
    dominant = {"method": method, "sales_share_pct": 80}
    summary = _executive_summary(
        start_date=date(2026, 10, 10),
        end_date=date(2026, 10, 10),
        net_sales=Decimal("100.00"),
        completed_orders=count,
        average_ticket=Decimal("20.00"),
        best_day=None,
        best_daypart=None,
        peak_hour=None,
        top_product=None,
        dominant_payment=dominant,
        refund_count=0,
        void_count=0,
    )
    actions = _recommended_actions(
        net_sales=Decimal("100.00"),
        completed_orders=count,
        best_daypart={"net_sales": Decimal("0.00")},
        top_product=None,
        dominant_payment=dominant,
        refund_count=0,
        void_count=0,
    )
    return {
        "summary": {"completed_orders": count, "net_sales": Decimal("100.00")},
        "executive_summary": summary,
        "dominant_payment": dominant,
        "recommended_actions": actions,
        "product_drivers": [{"product_name": "5 ordenes. Cash representa", "gross_sales": Decimal("100.00")}],
    }


def _api_story(monkeypatch, engine_story: dict) -> dict:
    def read_story(db, *, tenant_id, start_date, end_date):
        assert tenant_id == UUID(int=1)
        assert start_date == end_date == date(2026, 10, 10)
        return engine_story

    monkeypatch.setattr(router.service, "business_story", read_story)
    return router.business_story(
        start_date=date(2026, 10, 10), end_date=date(2026, 10, 10),
        db=None, ctx=(None, SimpleNamespace(tenant_id=UUID(int=1)), None),
    )


@pytest.mark.parametrize(
    ("method", "label"),
    [("cash", "Efectivo"), ("bank_transfer", "Transferencia"), ("manual_card", "Tarjeta manual")],
)
def test_business_story_payment_copy_uses_spanish_labels_without_changing_action_rules(
    monkeypatch, method: str, label: str
) -> None:
    response = _api_story(monkeypatch, _engine_story(method))
    summary = response["executive_summary"]
    actions = response["recommended_actions"]
    assert f"{label} concentró 80% de los cobros." in summary
    assert "MX$100.00 en ventas netas a partir de 5 órdenes" in summary
    assert "El ticket promedio fue MX$20.00." in summary
    cash_actions = [a for a in actions if a["title"] == "Reduce dependencia de efectivo"]
    if method == "cash":
        assert len(cash_actions) == 1
        assert cash_actions[0]["detail"] == (
            "Efectivo representa 80% de los cobros. Incentiva tarjeta o transferencia "
            "para facilitar conciliación."
        )
    else:
        assert cash_actions == []
    assert "Cash representa" not in " ".join(a["detail"] for a in actions)


def test_business_story_presentation_does_not_mutate_engine_data(monkeypatch):
    original = _engine_story("cash")
    before = deepcopy(original)
    response = _api_story(monkeypatch, original)
    assert "5 órdenes" in response["executive_summary"]
    assert original == before
    assert response["summary"] == before["summary"]
    assert response["dominant_payment"] == before["dominant_payment"]
    assert response["product_drivers"] == before["product_drivers"]
    assert response["recommended_actions"][0]["type"] == before["recommended_actions"][0]["type"]
    assert response["recommended_actions"][0]["title"] == before["recommended_actions"][0]["title"]


@pytest.mark.parametrize("count,phrase", [(0, "no hay ventas completadas"), (1, "1 orden")])
def test_business_story_presentation_preserves_singular_and_empty_period(monkeypatch, count, phrase):
    response = _api_story(monkeypatch, _engine_story("cash", count))
    assert phrase in response["executive_summary"]
    assert response["summary"]["completed_orders"] == count

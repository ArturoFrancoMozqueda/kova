from datetime import date
from decimal import Decimal

import pytest

from app.reports.service import _executive_summary, _recommended_actions


@pytest.mark.parametrize(
    ("method", "label"),
    [("cash", "Efectivo"), ("bank_transfer", "Transferencia"), ("manual_card", "Tarjeta manual")],
)
def test_business_story_payment_copy_uses_spanish_labels_without_changing_action_rules(
    method: str, label: str
) -> None:
    dominant = {"method": method, "sales_share_pct": 80}
    summary = _executive_summary(
        start_date=date(2026, 10, 10),
        end_date=date(2026, 10, 10),
        net_sales=Decimal("100.00"),
        completed_orders=5,
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
        completed_orders=5,
        best_daypart={"net_sales": Decimal("0.00")},
        top_product=None,
        dominant_payment=dominant,
        refund_count=0,
        void_count=0,
    )
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

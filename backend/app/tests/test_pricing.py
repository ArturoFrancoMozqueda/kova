from decimal import Decimal

from app.pricing import calculator


def test_line_total_multiplies_decimal_money():
    assert calculator.line_total(Decimal("18.50"), 2) == Decimal("37.00")


def test_order_total_sums_decimal_money():
    assert calculator.order_total([Decimal("12.30"), Decimal("18.50")]) == Decimal("30.80")


def test_money_quantizes_to_two_places():
    assert calculator.money(Decimal("10.005")) == Decimal("10.01")

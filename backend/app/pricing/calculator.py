from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def line_total(unit_price: Decimal, quantity: int) -> Decimal:
    if quantity <= 0:
        raise ValueError("Quantity must be positive")
    return money(unit_price * Decimal(quantity))


def order_total(line_totals: list[Decimal]) -> Decimal:
    return money(sum(line_totals, Decimal("0.00")))

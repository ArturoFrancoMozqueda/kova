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


def sale_pricing(line_totals: list[Decimal], discount: Decimal, tax_rate: Decimal):
    """Allocate the collected total by cumulative rounding; cents never disappear."""
    subtotal = order_total(line_totals)
    discount = money(discount)
    if discount < 0 or discount > subtotal:
        raise ValueError("El descuento no puede superar el subtotal")
    if tax_rate < 0 or tax_rate > 100:
        raise ValueError("El impuesto debe estar entre 0 y 100%")
    tax = money((subtotal - discount) * tax_rate / Decimal(100))
    total = money(subtotal - discount + tax)
    net_lines = allocate_amount(line_totals, subtotal - discount)
    taxes = allocate_amount(net_lines, tax)
    allocated = [net + tax for net, tax in zip(net_lines, taxes, strict=True)]
    return subtotal, tax, total, allocated


def allocate_amount(weights: list[Decimal], amount: Decimal) -> list[Decimal]:
    denominator = order_total(weights)
    allocated = []
    cumulative = Decimal(0)
    previous = Decimal(0)
    for weight in weights:
        cumulative += weight
        current = money(amount * cumulative / denominator) if denominator else Decimal("0.00")
        allocated.append(current - previous)
        previous = current
    return allocated


def refund_line_total(line_total: Decimal, quantity: int, refunded: int, requested: int):
    """Cumulative rounding returns every collected cent exactly once."""
    return money(line_total * (refunded + requested) / quantity) - money(
        line_total * refunded / quantity
    )

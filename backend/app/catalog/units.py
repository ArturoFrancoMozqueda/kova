"""Stock and purchase units for catalog products.

Inventory is stored as whole numbers of a base unit. Grams and millilitres
let a café track milk or flour without fractional stock; pieces keep every
existing product unchanged. A purchase unit only converts received
quantities and states what ``cost_price`` refers to.
"""

from decimal import Decimal
from typing import Literal

StockUnit = Literal["pza", "g", "ml"]
STOCK_UNITS: tuple[str, ...] = ("pza", "g", "ml")


def units_per_purchase(product) -> int:
    return product.purchase_unit_quantity or 1


def stock_unit_cost(product) -> Decimal | None:
    """Unrounded cost of one base unit; None when the cost is unknown.

    ``cost_price`` is the cost of one purchase unit when the product has one
    (``$25`` per ``Litro`` = 1000 ml) and of one base unit otherwise. Callers
    multiply by a quantity first and round the money result once.
    """
    if product.cost_price is None:
        return None
    return product.cost_price / Decimal(units_per_purchase(product))

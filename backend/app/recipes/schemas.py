from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.catalog.units import StockUnit
from app.shared.validation import StrictModel

MAX_LINES = 50
MAX_QUANTITY = 1_000_000


class RecipeLineWrite(StrictModel):
    ingredient_product_id: UUID
    quantity: int = Field(gt=0, le=MAX_QUANTITY)


class RecipeWrite(StrictModel):
    # An empty list stops consuming ingredients from now on; history is kept.
    lines: list[RecipeLineWrite] = Field(default_factory=list, max_length=MAX_LINES)

    @model_validator(mode="after")
    def unique_ingredients(self):
        ids = [line.ingredient_product_id for line in self.lines]
        if len(ids) != len(set(ids)):
            raise ValueError("No repitas un insumo en la receta")
        return self


class OptionConsumptionLineWrite(StrictModel):
    ingredient_product_id: UUID
    quantity: int = Field(ge=-MAX_QUANTITY, le=MAX_QUANTITY)

    @model_validator(mode="after")
    def non_zero(self):
        if self.quantity == 0:
            raise ValueError("La cantidad no puede ser cero")
        return self


class OptionConsumptionWrite(StrictModel):
    lines: list[OptionConsumptionLineWrite] = Field(default_factory=list, max_length=MAX_LINES)

    @model_validator(mode="after")
    def unique_ingredients(self):
        ids = [line.ingredient_product_id for line in self.lines]
        if len(ids) != len(set(ids)):
            raise ValueError("No repitas un insumo en el ajuste")
        return self


class CostedLine(BaseModel):
    ingredient_product_id: UUID
    ingredient_name: str
    stock_unit: StockUnit
    quantity: int
    # Cost of this quantity; None when the ingredient has no known cost.
    cost: Decimal | None


class RecipeResponse(BaseModel):
    product_id: UUID
    version: int | None
    effective_from: datetime | None
    lines: list[CostedLine]
    # Cost of one sold unit with no modifiers; None when any ingredient lacks cost.
    cost: Decimal | None
    known_cost: Decimal
    ingredients_without_cost: int


class OptionConsumptionResponse(BaseModel):
    modifier_option_id: UUID
    lines: list[CostedLine]
    cost_delta: Decimal | None

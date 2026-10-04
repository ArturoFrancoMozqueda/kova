from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.shared.validation import StrictModel, omit_null_default, reject_html, reject_null

ExpenseCategory = Literal[
    "renta",
    "nomina",
    "servicios",
    "transporte",
    "mantenimiento",
    "marketing",
    "comisiones",
    "impuestos",
    "otro",
]


class ExpenseCreate(StrictModel):
    category: ExpenseCategory
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    expense_date: date
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def validate_note(cls, value: str | None) -> str | None:
        value = reject_html(value)
        if value is None:
            return None
        return value.strip() or None


class ExpenseUpdate(StrictModel):
    category: ExpenseCategory | SkipJsonSchema[None] = Field(
        default=None, json_schema_extra=omit_null_default
    )
    amount: (
        Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)] | SkipJsonSchema[None]
    ) = Field(default=None, json_schema_extra=omit_null_default)
    expense_date: date | SkipJsonSchema[None] = Field(
        default=None, json_schema_extra=omit_null_default
    )
    note: str | None = Field(default=None, max_length=500)

    _required_fields = field_validator("category", "amount", "expense_date", mode="before")(
        reject_null
    )

    @field_validator("note")
    @classmethod
    def validate_note(cls, value: str | None) -> str | None:
        value = reject_html(value)
        if value is None:
            return None
        return value.strip() or None

    @model_validator(mode="after")
    def require_change(self):
        if not self.model_fields_set:
            raise ValueError("Envía al menos un campo para actualizar")
        return self


class ExpenseResponse(StrictModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category: ExpenseCategory
    amount: Decimal
    expense_date: date
    note: str | None
    created_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime

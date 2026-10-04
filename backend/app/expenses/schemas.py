from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.shared.validation import StrictModel, non_nullable_patch_schema, reject_html, reject_null

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
    category: ExpenseCategory | None = Field(
        default=None, json_schema_extra=non_nullable_patch_schema
    )
    amount: Decimal | None = Field(
        default=None,
        gt=0,
        max_digits=12,
        decimal_places=2,
        json_schema_extra=non_nullable_patch_schema,
    )
    expense_date: date | None = Field(default=None, json_schema_extra=non_nullable_patch_schema)
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

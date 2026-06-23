from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.shared.validation import MAX_MODIFIER_GROUP_ASSIGNMENTS, StrictModel


class ModifierOptionCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    price_delta: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    sort_order: int = 0


class ModifierOptionUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    price_delta: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    sort_order: int | None = None
    is_active: bool | None = None


class ModifierOptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    group_id: UUID
    name: str
    price_delta: Decimal
    sort_order: int
    is_active: bool


class ModifierGroupCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    is_required: bool = False
    min_selections: int = Field(default=0, ge=0)
    max_selections: int = Field(default=1, ge=1)
    sort_order: int = 0


class ModifierGroupUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_required: bool | None = None
    min_selections: int | None = Field(default=None, ge=0)
    max_selections: int | None = Field(default=None, ge=1)
    sort_order: int | None = None
    is_active: bool | None = None


class ModifierGroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    name: str
    is_required: bool
    min_selections: int
    max_selections: int
    sort_order: int
    is_active: bool
    options: list[ModifierOptionResponse] = []


class ProductModifierGroupAssignment(StrictModel):
    modifier_group_id: UUID
    sort_order: int = 0


class SetProductModifierGroups(StrictModel):
    assignments: list[ProductModifierGroupAssignment] = Field(
        max_length=MAX_MODIFIER_GROUP_ASSIGNMENTS
    )

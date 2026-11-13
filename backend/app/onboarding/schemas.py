from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from app.shared.validation import StrictModel

PresetName = Literal["cafe", "bakery", "retail", "abarrotes"]


class PresetApplyRequest(StrictModel):
    preset: PresetName


class PresetProductPreview(BaseModel):
    name: str
    category: str | None
    price_amount: Decimal


class PresetPreviewResponse(BaseModel):
    """Read-only contents of a starter catalog, shown before the owner applies it."""

    preset: str
    label: str
    categories: list[str]
    products: list[PresetProductPreview]


class PresetApplyResponse(BaseModel):
    preset: str
    categories_created: int
    products_created: int
    skipped: bool


class OnboardingStepResponse(BaseModel):
    key: str
    label: str
    completed: bool
    action_path: str


class OnboardingStateResponse(BaseModel):
    tenant_id: str
    completed_count: int
    total_count: int
    steps: list[OnboardingStepResponse]

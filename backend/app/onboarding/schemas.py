from typing import Literal

from pydantic import BaseModel

from app.shared.validation import StrictModel


class PresetApplyRequest(StrictModel):
    preset: Literal["cafe", "bakery", "retail"]


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

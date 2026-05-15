from typing import Literal

from pydantic import BaseModel


class PresetApplyRequest(BaseModel):
    preset: Literal["bakery", "retail"]


class PresetApplyResponse(BaseModel):
    preset: str
    categories_created: int
    products_created: int
    skipped: bool

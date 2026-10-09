from typing import Literal
from uuid import UUID

from pydantic import Field

from app.shared.validation import StrictModel


class DeviceSetup(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    pin: Literal[0, 1] = 0
    auto_open: bool = False


class PairDevice(StrictModel):
    code: str = Field(min_length=100, max_length=150)


class OpenDrawer(StrictModel):
    request_id: UUID
    kind: Literal["sale", "manual", "test"]
    order_id: UUID | None = None
    reason: str = Field(default="", max_length=200)


class Acknowledge(StrictModel):
    status: Literal["sent", "failed"]

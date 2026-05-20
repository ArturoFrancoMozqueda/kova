from typing import Any

from pydantic import BaseModel, Field


class TelemetryEventCreate(BaseModel):
    event_name: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    client_event_id: str = Field(min_length=1, max_length=80)
    properties: dict[str, Any] = Field(default_factory=dict)


class TelemetryEventResponse(BaseModel):
    accepted: bool = True

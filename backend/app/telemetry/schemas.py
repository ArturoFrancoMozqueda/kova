from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.shared.validation import StrictModel

MAX_PROPERTIES = 50
MAX_PROPERTY_KEY_LEN = 80
MAX_PROPERTY_VALUE_LEN = 500


class TelemetryEventCreate(StrictModel):
    event_name: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9_.:-]+$")
    client_event_id: str = Field(min_length=1, max_length=80)
    properties: dict[str, Any] = Field(default_factory=dict)

    @field_validator("properties")
    @classmethod
    def _bound_properties(cls, value: dict[str, Any]) -> dict[str, Any]:
        # Cap the unbounded JSON blob so a client can't store arbitrarily large
        # payloads in the telemetry table (cheap storage-abuse / DoS vector).
        if len(value) > MAX_PROPERTIES:
            raise ValueError(f"properties supports at most {MAX_PROPERTIES} keys")
        for key, val in value.items():
            if len(str(key)) > MAX_PROPERTY_KEY_LEN:
                raise ValueError("property key is too long")
            if isinstance(val, str) and len(val) > MAX_PROPERTY_VALUE_LEN:
                raise ValueError("property value is too long")
        return value


class TelemetryEventResponse(BaseModel):
    accepted: bool = True

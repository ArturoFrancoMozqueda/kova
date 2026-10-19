from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

TemplateKey = Literal["order_ready", "order_fulfilled", "restock_review", "service_case_overdue"]


class RuleWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    expected_version: int = Field(ge=0)


class RunResolve(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    status: Literal["completed", "dismissed"]


class RuleResponse(BaseModel):
    template_key: TemplateKey
    title: str
    description: str
    enabled: bool
    version: int


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    template_key: TemplateKey
    title: str
    status: Literal["pending", "completed", "dismissed", "suppressed"]
    entity_id: UUID
    entity_type: Literal["customer_order", "product", "service_case"]
    entity_version: int
    version: int
    created_at: datetime
    resolved_at: datetime | None

    @field_validator("created_at", "resolved_at")
    @classmethod
    def canonical_timestamp(cls, value):
        return value.astimezone(UTC) if value is not None else None


class Capabilities(BaseModel):
    internal_tasks: Literal[True] = True
    external_messaging: Literal[False] = False
    financial_actions: Literal[False] = False


class AutomationOverview(BaseModel):
    rules: list[RuleResponse]
    runs: list[RunResponse]
    capabilities: Capabilities = Field(default_factory=Capabilities)


class ProcessResponse(BaseModel):
    processed: int
    created: int
    suppressed: int

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.shared.validation import StrictModel


class ConversationCreate(StrictModel):
    title: str = Field(default="Conversación privada", min_length=1, max_length=120)


class MessageCreate(StrictModel):
    content: str = Field(min_length=1, max_length=4000)


class PreferenceWrite(StrictModel):
    chat_consent: bool = False
    chat_provider: Literal["cloudflare", "groq", "openrouter"] | None = None
    chat_recipients: Literal["groq+cerebras", "mistral"] | None = None
    document_consent: bool = False
    email_opt_in: bool = False
    frequency: Literal["daily", "weekly"] = "weekly"


class MemoryWrite(StrictModel):
    content: str = Field(min_length=1, max_length=2000)
    shared: bool = False
    source_ids: list[UUID] = Field(default_factory=list, max_length=8)


class GoalWrite(StrictModel):
    title: str = Field(min_length=1, max_length=120)
    metric: Literal["net_sales", "order_count"]
    target: str = Field(pattern=r"^\d{1,10}(\.\d{1,2})?$")
    start_date: date
    end_date: date
    shared: bool = False

    @model_validator(mode="after")
    def valid_target(self):
        value = Decimal(self.target)
        if value <= 0 or (self.metric == "order_count" and value != value.to_integral_value()):
            raise ValueError("La meta debe ser positiva; los tickets son cantidades enteras.")
        return self


class Step(StrictModel):
    action: Literal[
        "business_profile",
        "receipt",
        "category_create",
        "category_update",
        "product_create",
        "product_update",
        "branch_create",
        "branch_update",
        "catalog_import",
        "invitation",
    ]
    resource_id: UUID | None = None
    values: dict


class ProposalCreate(StrictModel):
    steps: list[Step] = Field(min_length=1, max_length=50)


class Confirm(StrictModel):
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


class ShareWrite(StrictModel):
    shared: bool


class TaskWrite(StrictModel):
    status: Literal["reviewed", "postponed", "declared_completed"]


class Answer(StrictModel):
    answer: str = Field(max_length=6000)
    source_ids: list[UUID] = Field(default_factory=list, max_length=8)
    steps: list[Step] = Field(default_factory=list, max_length=50)

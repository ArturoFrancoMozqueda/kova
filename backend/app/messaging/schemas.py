from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.shared.validation import StrictModel, reject_html


class InboxConversationCreate(StrictModel):
    customer_id: UUID
    subject: str = Field(min_length=1, max_length=160)

    @field_validator("subject")
    @classmethod
    def clean(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Escribe un asunto")
        return reject_html(value)


class InboxConversationUpdate(StrictModel):
    expected_version: int = Field(ge=1)
    status: Literal["open", "closed"] | None = None
    automation_paused: bool | None = None
    assigned_user_id: UUID | None = None
    customer_id: UUID | None = None

    @field_validator("status", "automation_paused")
    @classmethod
    def non_null(cls, value):
        if value is None:
            raise ValueError("El valor no puede ser nulo")
        return value


class InboxMessageCreate(StrictModel):
    body: str = Field(min_length=1, max_length=4096)
    purpose: Literal["transactional", "marketing"] = "transactional"

    @field_validator("body")
    @classmethod
    def clean(cls, value):
        value = value.strip()
        if not value or "\x00" in value:
            raise ValueError("Escribe un mensaje válido")
        return reject_html(value)


class InboxMessageTransition(StrictModel):
    expected_version: int = Field(ge=1)
    action: Literal["queue", "cancel"]


class InboxHumanSend(StrictModel):
    expected_version: int = Field(ge=1)


class InboxCatalogDraft(StrictModel):
    expected_version: int = Field(ge=1)


class InboxConnectionStatus(BaseModel):
    status: Literal["not_connected", "connected", "configuration_error"]
    send_enabled: bool
    receive_enabled: bool


class SignupAvailability(BaseModel):
    available: bool
    can_manage: bool
    app_id: str | None = None
    config_id: str | None = None
    graph_version: str | None = None
    state: Literal["not_started", "pending", "processing", "connected", "review_required", "failed"]


class SendingSettings(StrictModel):
    enabled: bool


class SignupStart(BaseModel):
    session_id: UUID
    nonce: str
    expires_at: datetime


class SignupFinish(StrictModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    session_id: UUID
    nonce: SecretStr = Field(min_length=32, max_length=128, repr=False)
    code: SecretStr = Field(min_length=1, max_length=8192, repr=False)
    waba_id: str = Field(pattern=r"^[1-9][0-9]{0,31}$")
    phone_number_id: str = Field(pattern=r"^[1-9][0-9]{0,31}$")
    # This implementation does not migrate numbers or enable coexistence.
    event: Literal["FINISH"]


class InboxConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    customer_id: UUID | None
    customer_name: str | None
    contact_phone: str | None = None
    subject: str
    origin: Literal["manual", "whatsapp"]
    status: Literal["open", "closed"]
    automation_paused: bool
    assigned_user_id: UUID | None
    version: int
    created_at: datetime
    updated_at: datetime


class InboxAutomationDraftCreate(StrictModel):
    automation_run_id: UUID
    expected_run_version: int = Field(ge=1)
    conversation_id: UUID


class InboxMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    conversation_id: UUID
    source_run_id: UUID | None
    direction: Literal["inbound", "outbound"]
    body: str | None
    message_type: str
    state: Literal[
        "received",
        "draft",
        "queued",
        "sending",
        "accepted",
        "sent",
        "delivered",
        "read",
        "failed",
        "uncertain",
        "cancelled",
        "suppressed",
    ]
    purpose: Literal["transactional", "marketing"] | None
    version: int
    error_code: str | None
    created_at: datetime
    updated_at: datetime


class InboxConversationList(BaseModel):
    items: list[InboxConversationResponse]
    has_more: bool
    channel_status: Literal["not_connected", "connected", "configuration_error"] = "not_connected"
    send_enabled: bool = False


class InboxMessageList(BaseModel):
    items: list[InboxMessageResponse]
    has_more: bool

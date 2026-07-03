from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# Shared status vocabulary for every ops signal:
# ok/warning/critical describe observed state; degraded means the source
# errored (unknown state); not_configured means the integration has no token.
OpsStatus = Literal["ok", "warning", "critical", "degraded", "not_configured"]


class OpsMeResponse(BaseModel):
    email: str
    is_internal_admin: Literal[True] = True


class SourceHealth(BaseModel):
    status: OpsStatus
    latency_ms: float | None = None
    detail: str | None = None
    checked_at: datetime | None = None


class VersionInfo(BaseModel):
    git_sha: str | None = None


class OverviewHealth(BaseModel):
    overall: OpsStatus
    sources: dict[str, SourceHealth]


class OverviewResponse(BaseModel):
    generated_at: datetime
    environment: str
    version: VersionInfo
    health: OverviewHealth


# ── Notes / triage ──────────────────────────────────────────────────────────

NoteEntityType = Literal["incident", "tenant", "general"]
NoteStatus = Literal["open", "resolved", "archived"]
TriageStatus = Literal["new", "acknowledged", "investigating", "resolved", "ignored"]


class OpsNoteCreate(BaseModel):
    entity_type: NoteEntityType
    entity_source: str | None = Field(default=None, max_length=40)
    entity_external_id: str | None = Field(default=None, max_length=255)
    tenant_id: UUID | None = None
    body: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def _require_entity_reference(self) -> "OpsNoteCreate":
        if self.entity_type == "incident" and not (
            self.entity_source and self.entity_external_id
        ):
            raise ValueError(
                "incident notes require entity_source and entity_external_id"
            )
        if self.entity_type == "tenant" and self.tenant_id is None:
            raise ValueError("tenant notes require tenant_id")
        return self


class OpsNoteUpdate(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=5000)
    status: NoteStatus | None = None
    pinned: bool | None = None

    @model_validator(mode="after")
    def _require_some_change(self) -> "OpsNoteUpdate":
        if self.body is None and self.status is None and self.pinned is None:
            raise ValueError("at least one of body, status or pinned is required")
        return self


class OpsNoteResponse(BaseModel):
    id: UUID
    author_user_id: UUID
    author_email: str
    entity_type: NoteEntityType
    entity_source: str | None
    entity_external_id: str | None
    tenant_id: UUID | None
    body: str
    status: NoteStatus
    pinned: bool
    created_at: datetime
    updated_at: datetime


class OpsNoteListResponse(BaseModel):
    items: list[OpsNoteResponse]
    total: int

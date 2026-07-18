from datetime import datetime

from pydantic import BaseModel, Field


class ScheduleDeletionRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    tenant_name: str = Field(min_length=1, max_length=255)


class DeletionStatusResponse(BaseModel):
    status: str
    requested_at: datetime | None = None
    purge_after: datetime | None = None


class PurgeResponse(BaseModel):
    purged: int

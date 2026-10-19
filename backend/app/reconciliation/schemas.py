from datetime import UTC, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.shared.validation import StrictModel, reject_html


class PreviewRequest(StrictModel):
    csv_content: str = Field(min_length=1, max_length=262144)


class CommitRequest(PreviewRequest):
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    parser_version: Literal[1]
    selected_rows: list[int] = Field(min_length=1, max_length=500)

    @field_validator("selected_rows")
    @classmethod
    def unique_rows(cls, values):
        if len(set(values)) != len(values) or min(values) < 2:
            raise ValueError("Selecciona filas válidas sin duplicados")
        return values


class PreviewRow(BaseModel):
    row_number: int
    settled_at: datetime
    gross_amount: Decimal
    fee_amount: Decimal
    net_amount: Decimal
    currency: Literal["MXN"]
    payment_method: Literal["bank_transfer", "manual_card"]
    external_reference_masked: str
    row_fingerprint: str


class RowError(BaseModel):
    row_number: int
    message: str


class ReconciliationPreviewResponse(BaseModel):
    parser_version: Literal[1] = 1
    content_sha256: str
    rows: list[PreviewRow]
    errors: list[RowError]


class BatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    row_count: int
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def canonical_timestamp(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)


class MatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    payment_id: UUID
    order_id: UUID
    matched_amount: Decimal
    status: Literal["suggested", "confirmed", "rejected", "reversed"]
    version: int
    reasons: list[str]


class EntryResponse(BaseModel):
    id: UUID
    batch_id: UUID
    settled_at: datetime
    gross_amount: Decimal
    fee_amount: Decimal
    net_amount: Decimal
    currency: Literal["MXN"]
    payment_method: Literal["bank_transfer", "manual_card"]
    external_reference_masked: str
    status: Literal["unmatched", "partially_matched", "matched"]
    matched_amount: Decimal
    remaining_amount: Decimal
    matches: list[MatchResponse]

    @field_validator("settled_at")
    @classmethod
    def canonical_timestamp(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)


class EntriesResponse(BaseModel):
    entries: list[EntryResponse]
    has_more: bool


class MatchAction(StrictModel):
    expected_version: int = Field(ge=1)
    reason: str | None = Field(default=None, min_length=3, max_length=200)

    @field_validator("reason", mode="before")
    @classmethod
    def clean(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("reason")
    @classmethod
    def plain(cls, value):
        return reject_html(value)


class EmptyAction(StrictModel):
    pass

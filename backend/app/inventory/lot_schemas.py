from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.shared.validation import INTEGER_MAX, StrictModel


class LotAllocation(StrictModel):
    lot_id: UUID
    quantity: int = Field(strict=True, gt=0, le=INTEGER_MAX)


class LotWrite(StrictModel):
    code: str = Field(min_length=1, max_length=100)
    manufactured_on: date | None = None
    rotation_on: date | None = None
    expires_on: date | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        self.code = self.code.strip()
        if not self.code:
            raise ValueError("Escribe un identificador para el lote")
        for value in (self.rotation_on, self.expires_on):
            if value and self.manufactured_on and value < self.manufactured_on:
                raise ValueError("La fecha límite no puede ser anterior a la elaboración")
        return self


class LotResponse(BaseModel):
    id: UUID
    product_id: UUID
    code: str
    is_unknown: bool
    manufactured_on: date | None
    rotation_on: date | None
    expires_on: date | None
    rotation_label: Literal["consumo_preferente", "fecha_objetivo"]
    stock_on_hand: int
    reserved_quantity: int
    available_quantity: int
    stock_conflict: bool
    date_status: Literal["sin_fecha", "vigente", "proximo", "vencido"]


class LotSnapshot(BaseModel):
    branch_id: UUID
    captured_at: datetime
    lots: list[LotResponse]
    applied_client_uuids: list[UUID] = Field(default_factory=list)


class LotReclassify(StrictModel):
    source_lot_id: UUID
    destination_lot_id: UUID
    quantity: int = Field(strict=True, gt=0, le=INTEGER_MAX)
    reason: str = Field(min_length=1, max_length=255)


class LotCount(StrictModel):
    lot_id: UUID
    counted_quantity: int = Field(strict=True, ge=0, le=INTEGER_MAX)


class LotSnapshotRequest(StrictModel):
    client_uuids: list[UUID] = Field(default_factory=list, max_length=1000)


class LotHistoryAllocation(BaseModel):
    lot_id: UUID
    quantity: int
    code: str

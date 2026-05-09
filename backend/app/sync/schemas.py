from uuid import UUID

from pydantic import BaseModel, Field

from app.orders.schemas import OrderCreate


class OfflineSaleSyncItem(BaseModel):
    client_uuid: UUID
    order: OrderCreate


class OfflineSaleSyncRequest(BaseModel):
    sales: list[OfflineSaleSyncItem] = Field(min_length=1)


class OfflineSaleSyncResult(BaseModel):
    client_uuid: UUID
    status: str
    order_id: UUID | None = None
    order: dict | None = None
    error: str | None = None


class OfflineSaleSyncResponse(BaseModel):
    results: list[OfflineSaleSyncResult]

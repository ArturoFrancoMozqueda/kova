from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.orders.schemas import OrderCreate
from app.shared.validation import MAX_OFFLINE_SALES_BATCH

# NOTE: Sync schemas stay on BaseModel (lenient) on purpose — see orders/schemas.py.
# Older offline bundles may include fields this version no longer defines, and
# rejecting them would drop already-confirmed sales. Batch size is still capped.


class OfflineSaleSyncItem(BaseModel):
    client_uuid: UUID
    branch_id: UUID | None = None
    order: OrderCreate
    # Shift that was open on the device when the sale was rung. Optional so
    # queue items created by older bundles keep syncing unchanged.
    shift_id: UUID | None = None
    # Client ring-time captured on the device when the sale was rung. Optional
    # so legacy queue items keep syncing (they fall back to server-now). The
    # server clamps this to a sane window; a client cannot rewrite history.
    occurred_at: datetime | None = None


class OfflineSaleSyncRequest(BaseModel):
    sales: list[OfflineSaleSyncItem] = Field(min_length=1, max_length=MAX_OFFLINE_SALES_BATCH)


class OfflineSaleSyncResult(BaseModel):
    client_uuid: UUID
    status: str
    order_id: UUID | None = None
    order: dict | None = None
    error: str | None = None


class OfflineSaleSyncResponse(BaseModel):
    results: list[OfflineSaleSyncResult]

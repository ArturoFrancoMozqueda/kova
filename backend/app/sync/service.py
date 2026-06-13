from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.orders import service as order_service
from app.shifts import repository as shifts_repo
from app.sync.schemas import OfflineSaleSyncItem, OfflineSaleSyncResult


def sync_offline_sales(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    sales: list[OfflineSaleSyncItem],
) -> list[OfflineSaleSyncResult]:
    results: list[OfflineSaleSyncResult] = []
    for sale in sales:
        try:
            # Sales are attributed to the shift that was open on the device at
            # ring time (sent by the client), verified tenant-scoped here. The
            # shift may already be closed by sync time — attribution is still
            # the historical truth and cannot disturb a closed shift's frozen
            # reconciliation. An unknown/foreign shift id degrades to
            # unattributed; attribution metadata never fails a sale.
            verified_shift_id: UUID | None = None
            if sale.shift_id:
                shift = shifts_repo.get_shift(
                    db, tenant_id=tenant_id, shift_id=sale.shift_id
                )
                if shift:
                    verified_shift_id = shift.id

            _, order = order_service.create_order(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                body=sale.order,
                idempotency_key=str(sale.client_uuid),
                client_uuid=sale.client_uuid,
                # Never link to the *current* drawer: by sync time it may be a
                # different shift than the one the sale was rung in.
                link_to_open_shift=False,
                shift_id=verified_shift_id,
            )
            results.append(
                OfflineSaleSyncResult(
                    client_uuid=sale.client_uuid,
                    status="synced",
                    order_id=UUID(order["id"]),
                    order=order,
                )
            )
        except HTTPException as exc:
            db.rollback()
            results.append(
                OfflineSaleSyncResult(
                    client_uuid=sale.client_uuid,
                    status="failed",
                    error=str(exc.detail),
                )
            )
    return results

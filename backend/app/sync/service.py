from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.orders import service as order_service
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
            _, order = order_service.create_order(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                body=sale.order,
                idempotency_key=str(sale.client_uuid),
                client_uuid=sale.client_uuid,
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

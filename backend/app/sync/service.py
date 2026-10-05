import logging
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.branches.scope import active_branch_id, bind_branch
from app.orders import repository as orders_repo
from app.orders import service as order_service
from app.shifts import repository as shifts_repo
from app.sync.schemas import OfflineSaleSyncItem, OfflineSaleSyncResult

logger = logging.getLogger(__name__)


def sync_offline_sales(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    sales: list[OfflineSaleSyncItem],
) -> list[OfflineSaleSyncResult]:
    results: list[OfflineSaleSyncResult] = []
    # Batch counters for observability (no PII): a spike in failed/replayed is a
    # signal of a sync regression or a client racing itself across tabs.
    synced = replayed = failed = 0
    request_branch = active_branch_id(db, tenant_id)
    for sale in sales:
        try:
            # Old bundles belong to principal; never infer origin from sync-time selection.
            bind_branch(db, tenant_id=tenant_id, branch_id=sale.branch_id or tenant_id)
            # Sales are attributed to the shift that was open on the device at
            # ring time (sent by the client), verified tenant-scoped here. The
            # shift may already be closed by sync time — attribution is still
            # the historical truth and cannot disturb a closed shift's frozen
            # reconciliation. An unknown/foreign shift id degrades to
            # unattributed; attribution metadata never fails a sale.
            verified_shift_id: UUID | None = None
            if sale.shift_id:
                shift = shifts_repo.get_shift(db, tenant_id=tenant_id, shift_id=sale.shift_id)
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
                occurred_at=sale.occurred_at,
            )
            results.append(
                OfflineSaleSyncResult(
                    client_uuid=sale.client_uuid,
                    status="synced",
                    order_id=UUID(order["id"]),
                    order=order,
                )
            )
            synced += 1
        except HTTPException as exc:
            # Business rejection (e.g. product not found, out of stock). Fail
            # only this sale; the rest of the batch continues.
            db.rollback()
            results.append(
                OfflineSaleSyncResult(
                    client_uuid=sale.client_uuid,
                    status="failed",
                    error=str(exc.detail),
                )
            )
            failed += 1
        except IntegrityError:
            # Concurrent sync of the same client_uuid (two tabs/devices racing):
            # one INSERT won and committed, this one hit
            # uq_orders_tenant_client_uuid. Resolve to the single committed
            # order and report synced — never a false dead-letter.
            db.rollback()
            existing = orders_repo.get_order_by_client_uuid(
                db, tenant_id=tenant_id, client_uuid=sale.client_uuid
            )
            if existing:
                order = order_service.get_order(db, tenant_id=tenant_id, order_id=existing.id)
                results.append(
                    OfflineSaleSyncResult(
                        client_uuid=sale.client_uuid,
                        status="synced",
                        order_id=existing.id,
                        order=order,
                    )
                )
                replayed += 1
            else:
                results.append(
                    OfflineSaleSyncResult(
                        client_uuid=sale.client_uuid,
                        status="failed",
                        error="Conflict while saving sale; please retry.",
                    )
                )
                failed += 1
        except Exception as exc:  # noqa: BLE001 - one bad sale must not 500 the batch
            # A non-HTTP error (bug, transient DB issue) must not abort the whole
            # request and false-dead-letter already-committed sales. Fail only
            # this item; log the full trace server-side, expose only the type.
            db.rollback()
            logger.exception("offline sale sync failed for client_uuid=%s", sale.client_uuid)
            results.append(
                OfflineSaleSyncResult(
                    client_uuid=sale.client_uuid,
                    status="failed",
                    error=f"Sync error: {type(exc).__name__}",
                )
            )
            failed += 1

        finally:
            db.info["kova_branch_id"] = request_branch

    logger.info(
        "offline_sales_sync batch tenant=%s attempted=%d synced=%d replayed=%d failed=%d",
        tenant_id,
        len(sales),
        synced,
        replayed,
        failed,
    )
    return results

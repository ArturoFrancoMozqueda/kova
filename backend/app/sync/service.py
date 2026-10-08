import logging
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.branches.scope import active_branch_id, bind_branch
from app.inventory import lots
from app.orders import repository as orders_repo
from app.orders import service as order_service
from app.shared.exceptions import bad_request, forbidden
from app.shifts import repository as shifts_repo
from app.sync.schemas import OfflineSaleSyncItem, OfflineSaleSyncResult

logger = logging.getLogger(__name__)


def sync_offline_sales(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    sales: list[OfflineSaleSyncItem],
    can_reconcile_lots: bool = False,
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

            order_body = sale.order
            if sale.lot_reconciliation:
                if not can_reconcile_lots:
                    raise forbidden(
                        "La conciliación de lotes requiere permiso para ajustar inventario"
                    )
                product_ids = {item.product_id for item in sale.order.items}
                if set(sale.lot_reconciliation) - product_ids:
                    raise bad_request("La conciliación contiene productos ajenos a la venta")
                pools = {pid: list(parts) for pid, parts in sale.lot_reconciliation.items()}
                updated = []
                for item in sale.order.items:
                    if item.product_id in pools:
                        if item.lot_allocations is not None:
                            raise bad_request(
                                "Los lotes cobrados no pueden sustituirse durante sincronización"
                            )
                        updated.append(
                            item.model_copy(
                                update={
                                    "lot_allocations": lots.split(
                                        pools[item.product_id], item.quantity
                                    )
                                }
                            )
                        )
                    else:
                        updated.append(item)
                if any(pools.values()):
                    raise bad_request("La conciliación excede las unidades cobradas")
                order_body = sale.order.model_copy(update={"items": updated})
                if (
                    orders_repo.get_order_by_client_uuid(
                        db, tenant_id=tenant_id, client_uuid=sale.client_uuid
                    )
                    is None
                ):
                    audit.log(
                        db,
                        tenant_id=tenant_id,
                        user_id=user_id,
                        action="offline.lot_reconciliation",
                        resource_type="offline_sale",
                        resource_id=sale.client_uuid,
                        changes={
                            "original_hash": order_service._hash_payload(
                                sale.order.model_dump(mode="json")
                            ),
                            "allocations": {
                                str(pid): [p.model_dump(mode="json") for p in parts]
                                for pid, parts in sale.lot_reconciliation.items()
                            },
                        },
                    )
            _, order = order_service.create_order(
                db,
                tenant_id=tenant_id,
                user_id=user_id,
                body=order_body,
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
            lot_conflict = isinstance(exc.detail, dict) and str(
                exc.detail.get("code", "")
            ).startswith("LOT_")
            results.append(
                OfflineSaleSyncResult(
                    client_uuid=sale.client_uuid,
                    status="failed",
                    error=exc.detail.get("message", str(exc.detail))
                    if lot_conflict
                    else str(exc.detail),
                    error_code=exc.detail.get("code") if isinstance(exc.detail, dict) else None,
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

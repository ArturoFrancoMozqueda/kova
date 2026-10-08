from datetime import UTC, date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.audit import service as audit
from app.auth.models import Membership, User, UserSession
from app.billing.access import require_commercial_access
from app.db import get_db
from app.inventory import lots, repository, service
from app.inventory.lot_schemas import (
    LotAllocation,
    LotReclassify,
    LotResponse,
    LotSnapshot,
    LotSnapshotRequest,
    LotWrite,
)
from app.inventory.router import _idempotency_key
from app.orders.models import Order
from app.rbac.permissions import Permission
from app.shared.dependencies import get_current_session
from app.shared.exceptions import bad_request

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"])


@router.get("/lots/snapshot", response_model=LotSnapshot)
def snapshot(
    client_uuid: list[UUID] = Query(default=[], max_length=1000),
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    from app.catalog.models import Product

    # Freeze tracked product writes while reading stock + applied local sales.
    db.query(Product).filter_by(tenant_id=membership.tenant_id, track_lots=True).order_by(
        Product.id
    ).with_for_update().all()
    return dict(
        branch_id=lots.active_branch_id(db, membership.tenant_id),
        captured_at=datetime.now(UTC),
        lots=lots.list_lots(db, membership.tenant_id),
        applied_client_uuids=[
            r[0]
            for r in db.query(Order.client_uuid)
            .filter(Order.tenant_id == membership.tenant_id, Order.client_uuid.in_(client_uuid))
            .all()
        ],
    )


@router.post("/lots/snapshot", response_model=LotSnapshot)
def snapshot_post(
    body: LotSnapshotRequest,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    return snapshot(client_uuid=body.client_uuids, db=db, ctx=ctx)


@router.get("/products/{product_id}/lots", response_model=list[LotResponse])
def list_product_lots(
    product_id: UUID,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    return lots.list_lots(db, membership.tenant_id, product_id)


@router.get("/products/{product_id}/lots/suggestions")
def date_suggestions(
    product_id: UUID,
    manufactured_on: date,
    db: Session = Depends(get_db),
    ctx: tuple[User, Membership, UserSession] = Depends(get_current_session),
):
    _, membership, _ = ctx
    product = service._tracked_product_for_update(
        db, tenant_id=membership.tenant_id, product_id=product_id
    )
    return lots.date_suggestions(product, manufactured_on)


def write_lot(db, tenant_id, user_id, product_id, body, key, lot_id=None):
    payload = {
        "operation": "inventory.lot.save",
        "product_id": str(product_id),
        "lot_id": str(lot_id) if lot_id else None,
        **body.model_dump(mode="json"),
    }
    previous = service._stored_response(
        db, tenant_id=tenant_id, idempotency_key=key, payload=payload
    )
    if previous:
        return previous
    product = service._tracked_product_for_update(db, tenant_id=tenant_id, product_id=product_id)
    lot = lots.save_lot(db, product, body, lot_id)
    result = next(
        row for row in lots.list_lots(db, tenant_id, product_id) if row["id"] == str(lot.id)
    )
    # JSON-ready dates also make the persisted idempotency response portable.
    result = LotResponse.model_validate(result).model_dump(mode="json")
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        action="inventory.lot.save",
        resource_type="inventory_lot",
        resource_id=lot.id,
        changes=payload,
    )
    status = 200 if lot_id else 201
    service._store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=key,
        payload=payload,
        status_code=status,
        response_body=result,
    )
    db.commit()
    return status, result


@router.post("/products/{product_id}/lots", response_model=LotResponse, status_code=201)
def create_lot(
    product_id: UUID,
    body: LotWrite,
    response: Response,
    db: Session = Depends(get_db),
    key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.INVENTORY_ADJUST)
    ),
):
    user, membership, _ = ctx
    response.status_code, result = write_lot(
        db, membership.tenant_id, user.id, product_id, body, key
    )
    return result


@router.put("/products/{product_id}/lots/{lot_id}", response_model=LotResponse)
def update_lot(
    product_id: UUID,
    lot_id: UUID,
    body: LotWrite,
    response: Response,
    db: Session = Depends(get_db),
    key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.INVENTORY_ADJUST)
    ),
):
    user, membership, _ = ctx
    response.status_code, result = write_lot(
        db, membership.tenant_id, user.id, product_id, body, key, lot_id
    )
    return result


@router.post("/products/{product_id}/lots/reclassify")
def reclassify(
    product_id: UUID,
    body: LotReclassify,
    db: Session = Depends(get_db),
    key: str = Depends(_idempotency_key),
    ctx: tuple[User, Membership, UserSession] = Depends(
        require_commercial_access(Permission.INVENTORY_ADJUST)
    ),
):
    user, membership, _ = ctx
    tenant_id = membership.tenant_id
    payload = {
        "operation": "inventory.lot.reclassify",
        "product_id": str(product_id),
        **body.model_dump(mode="json"),
    }
    previous = service._stored_response(
        db, tenant_id=tenant_id, idempotency_key=key, payload=payload
    )
    if previous:
        return previous[1]
    product = service._tracked_product_for_update(db, tenant_id=tenant_id, product_id=product_id)
    if body.source_lot_id == body.destination_lot_id:
        raise bad_request("Selecciona dos lotes distintos")
    source = [LotAllocation(lot_id=body.source_lot_id, quantity=body.quantity)]
    destination = [LotAllocation(lot_id=body.destination_lot_id, quantity=body.quantity)]
    lots.choose(db, product, body.quantity, source)
    lots.choose(db, product, body.quantity, destination, incoming=True)
    for delta, parts in ((-body.quantity, source), (body.quantity, destination)):
        movement = repository.create_movement(
            db,
            tenant_id=tenant_id,
            product_id=product.id,
            user_id=user.id,
            movement_type="stock_take",
            lot_tracked=True,
            quantity_delta=delta,
            reason=f"Clasificación de lotes: {body.reason}",
        )
        lots.attach(db, movement, parts, required=True)
    result = {"product_id": str(product_id), "quantity": body.quantity}
    audit.log(
        db,
        tenant_id=tenant_id,
        user_id=user.id,
        action="inventory.lot.reclassify",
        resource_type="product",
        resource_id=product.id,
        changes=payload,
    )
    service._store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=key,
        payload=payload,
        status_code=200,
        response_body=result,
    )
    db.commit()
    return result

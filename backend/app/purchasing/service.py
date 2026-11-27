from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit
from app.catalog.models import Product
from app.catalog.units import units_per_purchase
from app.inventory import lots
from app.inventory import repository as inventory
from app.inventory.service import _store_response, _stored_response, _validate_movement_range
from app.pricing import calculator
from app.purchasing.models import PurchaseOrder, PurchaseOrderItem, Supplier
from app.purchasing.schemas import (
    PurchaseCreate,
    PurchaseReceive,
    PurchaseResponse,
    SupplierCreate,
    SupplierResponse,
)
from app.shared.exceptions import bad_request, conflict, not_found


def suppliers(db: Session, tenant_id: UUID):
    return (
        db.query(Supplier)
        .filter(Supplier.tenant_id == tenant_id, Supplier.is_active.is_(True))
        .order_by(Supplier.name)
        .all()
    )


def serialize(db: Session, order: PurchaseOrder, items: list | None = None):
    if items is None:
        items = (
            db.query(PurchaseOrderItem)
            .filter(
                PurchaseOrderItem.tenant_id == order.tenant_id,
                PurchaseOrderItem.purchase_order_id == order.id,
            )
            .order_by(PurchaseOrderItem.product_name)
            .all()
        )
    return PurchaseResponse(
        **{
            field: getattr(order, field)
            for field in (
                "id",
                "branch_id",
                "supplier_id",
                "supplier_name",
                "status",
                "notes",
                "created_at",
            )
        },
        items=items,
    ).model_dump(mode="json")


def orders(db: Session, tenant_id: UUID, limit: int = 100, offset: int = 0):
    rows = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.tenant_id == tenant_id)
        .order_by(PurchaseOrder.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    # One IN query for the page's items instead of one query per purchase order.
    items_by_order: dict[UUID, list[PurchaseOrderItem]] = {row.id: [] for row in rows}
    if rows:
        for item in (
            db.query(PurchaseOrderItem)
            .filter(
                PurchaseOrderItem.tenant_id == tenant_id,
                PurchaseOrderItem.purchase_order_id.in_(list(items_by_order)),
            )
            .order_by(PurchaseOrderItem.product_name)
            .all()
        ):
            items_by_order[item.purchase_order_id].append(item)
    return [serialize(db, order, items_by_order[order.id]) for order in rows]


def _finish(
    db, tenant_id, user_id, key, payload, body, action, resource_id, status=201, *, commit=True
):
    audit.log(
        db,
        action=action,
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="purchase" if action.startswith("purchasing.order") else "supplier",
        resource_id=resource_id,
        changes=body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=key,
        payload=payload,
        status_code=status,
        response_body=body,
    )
    if commit:
        db.commit()
    return status, body


def create_supplier(db: Session, *, tenant_id: UUID, user_id: UUID, body: SupplierCreate, key: str):
    payload = {"operation": "purchasing.supplier.create", **body.model_dump(mode="json")}
    for part in payload.get("items", []):
        if part.get("lot_allocations") is None:
            part.pop("lot_allocations", None)
    existing = _stored_response(db, tenant_id=tenant_id, idempotency_key=key, payload=payload)
    if existing:
        return existing
    row = Supplier(tenant_id=tenant_id, **body.model_dump())
    db.add(row)
    db.flush()
    result = SupplierResponse.model_validate(row).model_dump(mode="json")
    # Contact details stay out of the audit trail.
    audit.log(
        db,
        action="purchasing.supplier.create",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="supplier",
        resource_id=row.id,
        changes={"id": str(row.id)},
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=key,
        payload=payload,
        status_code=201,
        response_body=result,
    )
    db.commit()
    return 201, result


def create_order(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: PurchaseCreate,
    key: str,
    commit: bool = True,
):
    payload = {"operation": "purchasing.order.create", **body.model_dump(mode="json")}
    for part in payload.get("items", []):
        if part.get("lot_allocations") is None:
            part.pop("lot_allocations", None)
    existing = _stored_response(db, tenant_id=tenant_id, idempotency_key=key, payload=payload)
    if existing:
        return existing
    supplier = (
        db.query(Supplier)
        .filter(
            Supplier.tenant_id == tenant_id,
            Supplier.id == body.supplier_id,
            Supplier.is_active.is_(True),
        )
        .first()
    )
    if not supplier:
        raise not_found("Proveedor no encontrado")
    products = {
        p.id: p
        for p in db.query(Product)
        .filter(
            Product.tenant_id == tenant_id,
            Product.id.in_([item.product_id for item in body.items]),
            Product.is_active.is_(True),
        )
        .order_by(Product.id)
        .with_for_update()
        .all()
    }
    if any(
        item.product_id not in products or not products[item.product_id].track_inventory
        for item in body.items
    ):
        raise bad_request("Selecciona productos activos con control de inventario")
    order = PurchaseOrder(
        tenant_id=tenant_id,
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        notes=body.notes,
        created_by_user_id=user_id,
    )
    db.add(order)
    db.flush()
    for item in body.items:
        product = products[item.product_id]
        db.add(
            PurchaseOrderItem(
                tenant_id=tenant_id,
                purchase_order_id=order.id,
                product_name=product.name,
                # Frozen so a later catalog change never rewrites what is in transit.
                units_per_purchase=units_per_purchase(product),
                purchase_unit_label=product.purchase_unit_label,
                **item.model_dump(),
            )
        )
    db.flush()
    result = serialize(db, order)
    return _finish(
        db,
        tenant_id,
        user_id,
        key,
        payload,
        result,
        "purchasing.order.create",
        order.id,
        commit=commit,
    )


def _difference(item: PurchaseOrderItem, incoming) -> str | None:
    """'over' when the line ends above the order, 'short' when closed with units missing."""
    total = item.received_quantity + incoming.quantity
    if total > item.quantity:
        return "over"
    if incoming.close_remaining and total < item.quantity:
        return "short"
    return None


def _settled(item: PurchaseOrderItem) -> bool:
    return item.closed_at is not None or item.received_quantity >= item.quantity


def _receive_units(db, order, item, product, incoming, body, tenant_id, user_id) -> dict:
    # Received in purchase units (2 Litros); stock moves in base units (2000 ml).
    stock_quantity = incoming.quantity * item.units_per_purchase
    stock = inventory.stock_on_hand(db, tenant_id=tenant_id, product_id=product.id)
    _validate_movement_range(quantity_delta=stock_quantity, stock_on_hand=stock + stock_quantity)
    parts = lots.choose(db, product, stock_quantity, incoming.lot_allocations, incoming=True)
    movement = inventory.create_movement(
        db,
        tenant_id=tenant_id,
        product_id=product.id,
        user_id=user_id,
        movement_type="purchase",
        lot_tracked=product.track_lots,
        quantity_delta=stock_quantity,
        reason=f"Compra {order.id}; partida {item.id}",
    )
    lots.attach(db, movement, parts, required=product.track_lots)
    old_cost = product.cost_price
    if body.update_catalog_cost:
        # unit_cost is per ordered unit; the catalog cost uses the product's
        # current purchase unit. Convert only when they differ.
        current_units = units_per_purchase(product)
        product.cost_price = (
            item.unit_cost
            if current_units == item.units_per_purchase
            else calculator.money(item.unit_cost * current_units / item.units_per_purchase)
        )
    return {
        "movement_id": str(movement.id),
        "stock_quantity": stock_quantity,
        "unit_cost": str(item.unit_cost),
        "previous_catalog_cost": str(old_cost) if old_cost is not None else None,
        "catalog_cost_updated": body.update_catalog_cost,
    }


def receive(
    db: Session, *, tenant_id: UUID, user_id: UUID, order_id: UUID, body: PurchaseReceive, key: str
):
    payload = {
        "operation": "purchasing.order.receive",
        "order_id": str(order_id),
        **body.model_dump(mode="json"),
    }
    # Fields added later are omitted when unset so earlier payloads keep their hash.
    for part in payload.get("items", []):
        for optional in ("lot_allocations", "close_remaining", "difference_reason"):
            if part.get(optional) is None:
                part.pop(optional, None)
    existing = _stored_response(db, tenant_id=tenant_id, idempotency_key=key, payload=payload)
    if existing:
        return existing
    order = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == order_id)
        .with_for_update()
        .first()
    )
    if not order:
        raise not_found("Compra no encontrada en esta sucursal")
    if order.status not in ("pending", "partial"):
        raise conflict("Esta compra ya está recibida o cancelada")
    items = (
        db.query(PurchaseOrderItem)
        .filter(
            PurchaseOrderItem.tenant_id == tenant_id,
            PurchaseOrderItem.purchase_order_id == order.id,
        )
        .all()
    )
    by_id = {item.id: item for item in items}
    for incoming in body.items:
        item = by_id.get(incoming.item_id)
        if item is None or item.closed_at is not None:
            raise bad_request("La recepción contiene una partida ajena o ya cerrada")
        if _difference(item, incoming) and not incoming.difference_reason:
            raise bad_request(
                "Escribe el motivo cuando recibes más de lo pedido o cierras con faltante"
            )
    # Product locks are shared with sales/adjustments; deterministic ordering prevents deadlocks.
    arriving = [item for item in body.items if item.quantity > 0]
    selected = sorted((by_id[item.item_id].product_id for item in arriving), key=str)
    products = {
        p.id: p
        for p in db.query(Product)
        .filter(Product.tenant_id == tenant_id, Product.id.in_(selected))
        .order_by(Product.id)
        .with_for_update()
        .all()
    }
    if len(products) != len(selected) or any(
        not p.track_inventory or not p.is_active for p in products.values()
    ):
        raise conflict("La compra contiene productos inactivos o sin inventario")
    changes = []
    now = datetime.now(UTC)
    for incoming in body.items:
        item = by_id[incoming.item_id]
        difference = _difference(item, incoming)
        change = {
            "item_id": str(item.id),
            "quantity": incoming.quantity,
            "ordered_quantity": item.quantity,
            "received_before": item.received_quantity,
        }
        if incoming.quantity > 0:
            change.update(
                _receive_units(
                    db, order, item, products[item.product_id], incoming, body, tenant_id, user_id
                )
            )
        item.received_quantity += incoming.quantity
        if difference:
            item.difference_reason = incoming.difference_reason
            change["difference_reason"] = incoming.difference_reason
            change["difference"] = item.received_quantity - item.quantity
        if difference == "short":
            item.closed_at = now
            change["closed_short"] = True
        changes.append(change)
    order.status = "received" if all(_settled(item) for item in items) else "partial"
    db.flush()
    result = serialize(db, order)
    audit.log(
        db,
        action="purchasing.order.receive",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="purchase",
        resource_id=order.id,
        changes={"branch_id": str(order.branch_id), "status": order.status, "receipts": changes},
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=key,
        payload=payload,
        status_code=200,
        response_body=result,
    )
    db.commit()
    return 200, result


def cancel(db: Session, *, tenant_id: UUID, user_id: UUID, order_id: UUID, key: str):
    payload = {"operation": "purchasing.order.cancel", "order_id": str(order_id)}
    for part in payload.get("items", []):
        if part.get("lot_allocations") is None:
            part.pop("lot_allocations", None)
    existing = _stored_response(db, tenant_id=tenant_id, idempotency_key=key, payload=payload)
    if existing:
        return existing
    order = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == order_id)
        .with_for_update()
        .first()
    )
    if not order:
        raise not_found("Compra no encontrada en esta sucursal")
    if order.status not in ("pending", "partial"):
        raise conflict("Esta compra ya está recibida o cancelada")
    order.status = "cancelled"
    db.flush()
    return _finish(
        db,
        tenant_id,
        user_id,
        key,
        payload,
        serialize(db, order),
        "purchasing.order.cancel",
        order.id,
        200,
    )

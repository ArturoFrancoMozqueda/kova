"""Lot dimensions of the existing ledger; callers hold the product lock.

No service here commits: callers persist the movement, its allocation, audit and
idempotency response together. Physical losses may reveal reservation conflicts.
"""

from datetime import date, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.branches.scope import active_branch_id, tenant_wide_branches, transfer_branches
from app.catalog.models import Product
from app.customer_orders.models import InventoryReservation
from app.inventory.lot_schemas import LotAllocation, LotWrite
from app.inventory.models import InventoryLot, InventoryLotAllocation, InventoryLotReservation
from app.orders.models import InventoryMovement
from app.shared.exceptions import bad_request, conflict, not_found
from app.shared.timezone import tenant_timezone


def lot_error(message: str, code: str = "LOT_STOCK_CONFLICT", **details):
    return HTTPException(409, detail={"code": code, "message": message, **details})


def unknown_lot(db: Session, product: Product) -> InventoryLot:
    lot = (
        db.query(InventoryLot)
        .filter_by(tenant_id=product.tenant_id, product_id=product.id, is_unknown=True)
        .first()
    )
    if lot is None:
        lot = InventoryLot(
            tenant_id=product.tenant_id,
            product_id=product.id,
            code="Lote y fecha desconocidos",
            is_unknown=True,
            rotation_label=product.rotation_label,
        )
        db.add(lot)
        db.flush()
    return lot


def configure(db: Session, product: Product, enabled: bool) -> None:
    if enabled == product.track_lots:
        return
    with tenant_wide_branches(db):
        totals = dict(
            db.query(InventoryMovement.branch_id, func.sum(InventoryMovement.quantity_delta))
            .filter_by(tenant_id=product.tenant_id, product_id=product.id)
            .group_by(InventoryMovement.branch_id)
            .all()
        )
        reservations = (
            db.query(InventoryReservation)
            .filter_by(tenant_id=product.tenant_id, product_id=product.id, status="active")
            .all()
        )
        if not enabled:
            if any(totals.values()) or reservations:
                raise conflict(
                    "Para desactivar lotes, todas las sucursales deben estar en cero y sin reservas"
                )
            product.track_lots = False
            return
        if any(q < 0 for q in totals.values()):
            raise conflict("Corrige las existencias negativas antes de activar lotes")
        by_branch = {}
        for reservation in reservations:
            by_branch[reservation.branch_id] = (
                by_branch.get(reservation.branch_id, 0) + reservation.quantity
            )
        if any(q > totals.get(branch, 0) for branch, q in by_branch.items()):
            raise conflict("Resuelve los faltantes de reservas antes de activar lotes")
        lot = unknown_lot(db, product)
        movements = (
            db.query(InventoryMovement)
            .filter_by(tenant_id=product.tenant_id, product_id=product.id)
            .filter(
                ~InventoryMovement.id.in_(
                    db.query(InventoryLotAllocation.movement_id).filter_by(
                        tenant_id=product.tenant_id, product_id=product.id
                    )
                )
            )
            .all()
        )
        with transfer_branches(db, set(totals) | set(by_branch)):
            for movement in movements:
                if movement.quantity_delta:
                    db.add(
                        InventoryLotAllocation(
                            tenant_id=product.tenant_id,
                            product_id=product.id,
                            branch_id=movement.branch_id,
                            movement_id=movement.id,
                            lot_id=lot.id,
                            quantity_delta=movement.quantity_delta,
                        )
                    )
            for reservation in reservations:
                reservation.lot_tracked = True
                db.query(InventoryLotReservation).filter_by(
                    tenant_id=product.tenant_id, reservation_id=reservation.id
                ).delete()
                db.add(
                    InventoryLotReservation(
                        tenant_id=product.tenant_id,
                        product_id=product.id,
                        branch_id=reservation.branch_id,
                        reservation_id=reservation.id,
                        lot_id=lot.id,
                        quantity=reservation.quantity,
                    )
                )

            product.track_lots = True
            db.flush()


def list_lots(
    db: Session,
    tenant_id: UUID,
    product_id: UUID | None = None,
    *,
    branch_id: UUID | None = None,
    excluding_reservation: UUID | None = None,
) -> list[dict]:
    branch = branch_id or active_branch_id(db, tenant_id)
    # Explicit branch filter also applies in the privileged two-branch transfer scope.
    stock_query = db.query(
        InventoryLotAllocation.lot_id, func.sum(InventoryLotAllocation.quantity_delta)
    ).filter_by(tenant_id=tenant_id, branch_id=branch)
    reserved_query = (
        db.query(InventoryLotReservation.lot_id, func.sum(InventoryLotReservation.quantity))
        .join(
            InventoryReservation, InventoryReservation.id == InventoryLotReservation.reservation_id
        )
        .filter(
            InventoryLotReservation.tenant_id == tenant_id,
            InventoryLotReservation.branch_id == branch,
            InventoryReservation.tenant_id == tenant_id,
            InventoryReservation.status == "active",
        )
    )
    if product_id:
        stock_query = stock_query.filter(InventoryLotAllocation.product_id == product_id)
        reserved_query = reserved_query.filter(InventoryLotReservation.product_id == product_id)
    if excluding_reservation:
        reserved_query = reserved_query.filter(InventoryReservation.id != excluding_reservation)
    stocks = dict(stock_query.group_by(InventoryLotAllocation.lot_id).all())
    reserved = dict(reserved_query.group_by(InventoryLotReservation.lot_id).all())
    query = db.query(InventoryLot).filter_by(tenant_id=tenant_id)
    if product_id:
        query = query.filter_by(product_id=product_id)
    else:
        query = query.join(Product, Product.id == InventoryLot.product_id).filter(
            Product.track_lots.is_(True), Product.is_active.is_(True)
        )
    today = datetime.now(tenant_timezone(db, tenant_id=tenant_id)).date()
    result = []
    for lot in query.all():
        limit = lot.expires_on or lot.rotation_on
        status = (
            "sin_fecha"
            if limit is None
            else "vencido"
            if limit < today
            else "proximo"
            if limit <= today + timedelta(days=7)
            else "vigente"
        )
        on_hand, apart = int(stocks.get(lot.id, 0)), int(reserved.get(lot.id, 0))
        result.append(
            dict(
                id=str(lot.id),
                product_id=str(lot.product_id),
                code=lot.code,
                is_unknown=lot.is_unknown,
                manufactured_on=lot.manufactured_on,
                rotation_on=lot.rotation_on,
                expires_on=lot.expires_on,
                rotation_label=lot.rotation_label,
                stock_on_hand=on_hand,
                reserved_quantity=apart,
                available_quantity=max(0, on_hand - apart),
                stock_conflict=apart > on_hand,
                date_status=status,
            )
        )
    return sorted(
        result,
        key=lambda row: (
            row["expires_on"] or row["rotation_on"] or row["manufactured_on"] or date.max,
            row["manufactured_on"] or date.max,
            row["id"],
        ),
    )


def choose(
    db: Session,
    product: Product,
    quantity: int,
    allocations: list[LotAllocation] | None,
    *,
    branch_id: UUID | None = None,
    physical_loss=False,
    excluding_reservation: UUID | None = None,
    incoming=False,
) -> list[LotAllocation]:
    if not product.track_lots:
        if allocations:
            raise lot_error(
                "El control de lotes cambió; revisa el producto antes de registrar la operación"
            )
        return []
    if allocations is None:
        raise lot_error(
            "Selecciona los lotes antes de registrar la operación",
            "LOT_SELECTION_REQUIRED",
            product_id=str(product.id),
        )
    merged: dict[UUID, int] = {}
    for part in allocations:
        merged[part.lot_id] = merged.get(part.lot_id, 0) + part.quantity
    if sum(merged.values()) != quantity:
        raise bad_request("La suma de lotes debe coincidir con la cantidad")
    db.query(InventoryLot).filter(
        InventoryLot.tenant_id == product.tenant_id,
        InventoryLot.product_id == product.id,
        InventoryLot.id.in_(merged),
    ).order_by(InventoryLot.id).with_for_update().all()
    rows = {
        UUID(row["id"]): row
        for row in list_lots(
            db,
            product.tenant_id,
            product.id,
            branch_id=branch_id,
            excluding_reservation=excluding_reservation,
        )
    }
    for lot_id, wanted in merged.items():
        row = rows.get(lot_id)
        if row is None:
            raise not_found("El lote no pertenece a este producto y negocio")
        available = row["stock_on_hand"] if physical_loss else row["available_quantity"]
        if not incoming and wanted > available:
            raise lot_error(
                "No alcanzan las unidades del lote elegido; "
                "concilia existencias o revisa las reservas",
                lot_id=str(lot_id),
                product_id=str(product.id),
                available=available,
                requested=wanted,
            )
    return [LotAllocation(lot_id=lot_id, quantity=q) for lot_id, q in merged.items()]


def suggest(
    db: Session, product: Product, quantity: int, *, excluding_reservation: UUID | None = None
) -> list[LotAllocation]:
    parts = []
    for row in list_lots(
        db, product.tenant_id, product.id, excluding_reservation=excluding_reservation
    ):
        take = min(quantity, row["available_quantity"])
        if take:
            parts.append(LotAllocation(lot_id=UUID(row["id"]), quantity=take))
            quantity -= take
        if not quantity:
            return parts
    raise lot_error("No hay lotes suficientes para reservar este pedido")


def attach(db: Session, movement: InventoryMovement, parts: list[LotAllocation], *, required: bool):
    if movement.lot_tracked != required:
        raise RuntimeError("Movement tracking must be captured before insertion")
    if parts:
        if sum(part.quantity for part in parts) != abs(movement.quantity_delta):
            raise bad_request("La asignación de lotes no concilia con el movimiento")
        for part in parts:
            db.add(
                InventoryLotAllocation(
                    tenant_id=movement.tenant_id,
                    branch_id=movement.branch_id,
                    product_id=movement.product_id,
                    movement_id=movement.id,
                    lot_id=part.lot_id,
                    quantity_delta=part.quantity * (1 if movement.quantity_delta > 0 else -1),
                )
            )
    db.flush()


def reservation_parts(db: Session, reservation: InventoryReservation) -> list[LotAllocation]:
    return [
        LotAllocation(lot_id=r.lot_id, quantity=r.quantity)
        for r in db.query(InventoryLotReservation)
        .filter_by(tenant_id=reservation.tenant_id, reservation_id=reservation.id)
        .order_by(InventoryLotReservation.lot_id)
        .all()
    ]


def assign_reservation(
    db: Session, product: Product, reservation: InventoryReservation, parts: list[LotAllocation]
):
    db.flush()
    db.query(InventoryLotReservation).filter_by(
        tenant_id=product.tenant_id, reservation_id=reservation.id
    ).delete()
    reservation.lot_tracked = product.track_lots
    for part in parts:
        db.add(
            InventoryLotReservation(
                tenant_id=product.tenant_id,
                branch_id=reservation.branch_id,
                product_id=product.id,
                reservation_id=reservation.id,
                lot_id=part.lot_id,
                quantity=part.quantity,
            )
        )
    db.flush()


def split(parts: list[LotAllocation], quantity: int) -> list[LotAllocation]:
    """Consume a per-product reservation across repeated sale lines."""
    result = []
    while quantity and parts:
        part = parts[0]
        take = min(quantity, part.quantity)
        result.append(LotAllocation(lot_id=part.lot_id, quantity=take))
        quantity -= take
        if take == part.quantity:
            parts.pop(0)
        else:
            parts[0] = LotAllocation(lot_id=part.lot_id, quantity=part.quantity - take)
    if quantity:
        raise lot_error("La asignación original no cubre las unidades")
    return result


def original_parts(db: Session, tenant_id: UUID, order_item_id: UUID) -> list[LotAllocation]:
    rows = (
        db.query(InventoryLotAllocation.lot_id, func.sum(InventoryLotAllocation.quantity_delta))
        .join(InventoryMovement, InventoryMovement.id == InventoryLotAllocation.movement_id)
        .filter(
            InventoryLotAllocation.tenant_id == tenant_id,
            InventoryMovement.order_item_id == order_item_id,
            InventoryMovement.tenant_id == tenant_id,
        )
        .group_by(InventoryLotAllocation.lot_id)
        .order_by(InventoryLotAllocation.lot_id)
        .all()
    )
    return [LotAllocation(lot_id=lot_id, quantity=-int(q)) for lot_id, q in rows if q < 0]


def save_lot(db: Session, product: Product, body: LotWrite, lot_id: UUID | None = None):
    if not product.track_lots:
        raise bad_request("Activa el control por lotes en este producto")
    lot = None
    if lot_id:
        lot = (
            db.query(InventoryLot)
            .filter_by(tenant_id=product.tenant_id, product_id=product.id, id=lot_id)
            .with_for_update()
            .first()
        )
        if lot is None or lot.is_unknown:
            raise bad_request(
                "El lote desconocido no puede recibir fechas; clasifica sus unidades en otro lote"
            )
    if body.code == "Lote y fecha desconocidos":
        raise bad_request("Ese identificador está reservado para existencias sin lote conocido")
    duplicate = (
        db.query(InventoryLot)
        .filter_by(tenant_id=product.tenant_id, product_id=product.id, code=body.code)
        .first()
    )
    if duplicate and (lot is None or duplicate.id != lot.id):
        raise conflict(
            "Ya existe ese lote para el producto; selecciónalo para recibir más unidades"
        )
    if lot is None:
        lot = InventoryLot(
            tenant_id=product.tenant_id,
            product_id=product.id,
            rotation_label=product.rotation_label,
            **body.model_dump(),
        )
        db.add(lot)
    else:
        for field, value in body.model_dump().items():
            setattr(lot, field, value)
    db.flush()
    return lot


def date_suggestions(product: Product, manufactured_on: date) -> dict:
    try:
        return {
            "manufactured_on": manufactured_on,
            "rotation_label": product.rotation_label,
            "rotation_on": manufactured_on + timedelta(days=product.rotation_days)
            if product.rotation_days
            else None,
            "expires_on": manufactured_on + timedelta(days=product.expiry_days)
            if product.expiry_days
            else None,
        }
    except OverflowError as exc:
        raise bad_request(
            "La regla excede el rango de fechas; revisa la elaboración y duración"
        ) from exc


def sale_history_parts(db: Session, tenant_id: UUID, order_item_id: UUID) -> list[dict]:
    rows = (
        db.query(InventoryLotAllocation, InventoryLot.code)
        .join(InventoryMovement, InventoryMovement.id == InventoryLotAllocation.movement_id)
        .join(InventoryLot, InventoryLot.id == InventoryLotAllocation.lot_id)
        .filter(
            InventoryLotAllocation.tenant_id == tenant_id,
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.order_item_id == order_item_id,
            InventoryMovement.quantity_delta < 0,
        )
        .all()
    )
    return [
        {"lot_id": str(part.lot_id), "quantity": -part.quantity_delta, "code": code}
        for part, code in rows
    ]

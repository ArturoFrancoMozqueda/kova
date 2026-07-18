import hashlib
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog.models import Product
from app.idempotency import service as idempotency_service
from app.inventory import repository as repo
from app.inventory.schemas import (
    InventoryAdjustmentCreate,
    LowStockThresholdUpdate,
    StockTakeCreate,
)
from app.orders.models import InventoryMovement
from app.shared.exceptions import bad_request, not_found


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def _stored_response(
    db: Session, *, tenant_id: UUID, idempotency_key: str, payload: dict[str, Any]
) -> tuple[int, dict[str, Any]] | None:
    existing = idempotency_service.get(db, tenant_id=tenant_id, key=idempotency_key)
    if not existing:
        return None
    if existing.request_hash != _hash_payload(payload):
        raise bad_request("Idempotency key reused with different request body")
    return existing.response_status or 200, existing.response_body or {}


def _store_response(
    db: Session,
    *,
    tenant_id: UUID,
    idempotency_key: str,
    payload: dict[str, Any],
    status_code: int,
    response_body: dict[str, Any],
) -> None:
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=_hash_payload(payload),
        response_status=status_code,
        response_body=response_body,
    )


def _stock_body(
    db: Session, *, tenant_id: UUID, product: Product, stock: int | None = None
) -> dict[str, Any]:
    if stock is None:
        stock = repo.stock_on_hand(db, tenant_id=tenant_id, product_id=product.id)
    threshold = product.low_stock_threshold
    return {
        "product_id": str(product.id),
        "product_name": product.name,
        "sku": product.sku,
        "track_inventory": product.track_inventory,
        "stock_on_hand": stock,
        "low_stock_threshold": threshold,
        "is_low_stock": product.track_inventory and threshold is not None and stock <= threshold,
    }


def _tracked_product_for_update(db: Session, *, tenant_id: UUID, product_id: UUID) -> Product:
    product = repo.get_product_for_update(db, tenant_id=tenant_id, product_id=product_id)
    if not product:
        raise not_found("Product not found")
    if not product.track_inventory:
        raise bad_request("Product does not track inventory")
    return product


def list_stock(db: Session, *, tenant_id: UUID) -> list[dict[str, Any]]:
    products = [
        product
        for product in repo.list_active_products(db, tenant_id=tenant_id)
        if product.track_inventory
    ]
    stock_map = repo.stock_on_hand_for_products(
        db, tenant_id=tenant_id, product_ids=[p.id for p in products]
    )
    return [
        _stock_body(db, tenant_id=tenant_id, product=product, stock=stock_map.get(product.id, 0))
        for product in products
    ]


def list_low_stock(db: Session, *, tenant_id: UUID) -> list[dict[str, Any]]:
    return [item for item in list_stock(db, tenant_id=tenant_id) if item["is_low_stock"]]


def inventory_velocity(db: Session, *, tenant_id: UUID) -> list[dict[str, Any]]:
    since = datetime.now(UTC) - timedelta(days=7)
    sales_rows = (
        db.query(
            InventoryMovement.product_id,
            func.coalesce(func.sum(InventoryMovement.quantity_delta), 0).label("units"),
        )
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.movement_type == "sale",
            InventoryMovement.created_at >= since,
        )
        .group_by(InventoryMovement.product_id)
        .all()
    )
    sold_by_product = {row.product_id: abs(int(row.units or 0)) for row in sales_rows}

    tracked_products = [
        product
        for product in repo.list_active_products(db, tenant_id=tenant_id)
        if product.track_inventory
    ]
    stock_map = repo.stock_on_hand_for_products(
        db, tenant_id=tenant_id, product_ids=[p.id for p in tracked_products]
    )

    results: list[dict[str, Any]] = []
    for product in tracked_products:
        stock = stock_map.get(product.id, 0)
        units_per_day = (Decimal(sold_by_product.get(product.id, 0)) / Decimal("7")).quantize(
            Decimal("0.01")
        )
        days_until_out = None
        if units_per_day > 0:
            days_until_out = (Decimal(stock) / units_per_day).quantize(Decimal("0.1"))
        results.append(
            {
                "product_id": product.id,
                "product_name": product.name,
                "units_per_day_7d": units_per_day,
                "days_until_out": days_until_out,
                "stock_on_hand": stock,
            }
        )

    return sorted(
        results,
        key=lambda row: (
            row["days_until_out"] is None,
            row["days_until_out"] if row["days_until_out"] is not None else Decimal("999999"),
            row["product_name"],
        ),
    )


def adjust_stock(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    body: InventoryAdjustmentCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    payload["product_id"] = str(product_id)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    product = _tracked_product_for_update(db, tenant_id=tenant_id, product_id=product_id)
    # Under the product row lock (taken above), reject any adjustment that would
    # drive on-hand negative. Without this floor a manual -N adjustment silently
    # corrupts stock counts, reorder logic, and reports. Legitimate loss is still
    # possible by adjusting down to exactly zero.
    current_stock = repo.stock_on_hand(db, tenant_id=tenant_id, product_id=product.id)
    resulting_stock = current_stock + body.quantity_delta
    if resulting_stock < 0:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "WOULD_GO_NEGATIVE",
                "available": current_stock,
                "requested_delta": body.quantity_delta,
                "message": (
                    "El ajuste dejaría el inventario en negativo. "
                    f"Disponible actual: {current_stock}."
                ),
            },
        )
    movement = repo.create_movement(
        db,
        tenant_id=tenant_id,
        product_id=product.id,
        user_id=user_id,
        movement_type="adjustment",
        quantity_delta=body.quantity_delta,
        reason=body.reason,
        reason_code=body.reason_code,
    )
    response_body = {
        "id": str(movement.id),
        "product_id": str(product.id),
        "movement_type": movement.movement_type,
        "quantity_delta": movement.quantity_delta,
        "stock_on_hand": repo.stock_on_hand(db, tenant_id=tenant_id, product_id=product.id),
        "reason": movement.reason or "",
        "reason_code": movement.reason_code,
    }
    audit_service.log(
        db,
        action="inventory.adjust",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="product",
        resource_id=product.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def stock_take(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    body: StockTakeCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    payload["product_id"] = str(product_id)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    product = _tracked_product_for_update(db, tenant_id=tenant_id, product_id=product_id)
    current_stock = repo.stock_on_hand(db, tenant_id=tenant_id, product_id=product.id)
    delta = body.counted_quantity - current_stock
    movement = None
    if delta != 0:
        movement = repo.create_movement(
            db,
            tenant_id=tenant_id,
            product_id=product.id,
            user_id=user_id,
            movement_type="stock_take",
            quantity_delta=delta,
            reason=body.reason,
        )
    response_body = {
        "id": str(movement.id) if movement else None,
        "product_id": str(product.id),
        "movement_type": "stock_take",
        "quantity_delta": delta,
        "stock_on_hand": repo.stock_on_hand(db, tenant_id=tenant_id, product_id=product.id),
        "reason": body.reason,
    }
    audit_service.log(
        db,
        action="inventory.stock_take",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="product",
        resource_id=product.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=201,
        response_body=response_body,
    )
    db.commit()
    return 201, response_body


def update_low_stock_threshold(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    body: LowStockThresholdUpdate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    payload["product_id"] = str(product_id)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored

    product = repo.get_product_for_update(db, tenant_id=tenant_id, product_id=product_id)
    if not product:
        raise not_found("Product not found")
    product.low_stock_threshold = body.low_stock_threshold
    db.flush()
    response_body = _stock_body(db, tenant_id=tenant_id, product=product)
    audit_service.log(
        db,
        action="inventory.low_stock_threshold.update",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="product",
        resource_id=product.id,
        changes=response_body,
    )
    _store_response(
        db,
        tenant_id=tenant_id,
        idempotency_key=idempotency_key,
        payload=payload,
        status_code=200,
        response_body=response_body,
    )
    db.commit()
    return 200, response_body

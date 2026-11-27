"""Batch production: a tray goes in, ingredients go out once, pieces come out.

Rules (specs/recipes/batch_production.md):
- A product produced in batches keeps its own stock; its batch recipe states
  the ingredients for one batch and the pieces it is expected to yield.
- Recording a batch consumes `line × batches` of each ingredient and adds the
  pieces actually obtained. Selling those pieces moves only the finished
  product, so the ingredients are never discounted twice.
- Fewer pieces than expected is a production loss with an explicit reason.
- Cost per piece = ingredient cost / pieces obtained. Unknown ingredient cost
  leaves it unknown, never $0. By default the catalog cost follows the last
  batch (policy documented in ADR-043).
"""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog.models import Product
from app.inventory.service import _store_response, _stored_response
from app.orders.models import InventoryMovement
from app.pricing import calculator
from app.recipes.models import ProductionBatch, Recipe, RecipeLine
from app.recipes.schemas import BatchRecipeWrite, ProductionCreate
from app.recipes.service import (
    CONSUMPTION,
    _costed,
    _jsonable,
    _lines,
    _products,
    _validate_ingredients,
)
from app.shared.exceptions import bad_request, not_found

PRODUCTION = "production"


def _now() -> datetime:
    return datetime.now(UTC)


def current_batch_recipe(db: Session, *, tenant_id: UUID, product_id: UUID) -> Recipe | None:
    return (
        db.query(Recipe)
        .filter(
            Recipe.tenant_id == tenant_id,
            Recipe.product_id == product_id,
            Recipe.mode == "batch",
            Recipe.effective_from <= _now(),
        )
        .order_by(Recipe.effective_from.desc(), Recipe.version.desc())
        .first()
    )


def _recipe_lines(db: Session, *, tenant_id: UUID, recipe: Recipe | None) -> list[RecipeLine]:
    if recipe is None:
        return []
    return _lines(db, tenant_id=tenant_id, recipe_ids=[recipe.id]).get(recipe.id, [])


def batch_recipe_body(db: Session, *, tenant_id: UUID, product_id: UUID) -> dict[str, Any]:
    if db.query(Product).filter_by(tenant_id=tenant_id, id=product_id).first() is None:
        raise not_found("Producto no encontrado")
    recipe = current_batch_recipe(db, tenant_id=tenant_id, product_id=product_id)
    lines = _recipe_lines(db, tenant_id=tenant_id, recipe=recipe)
    quantities = {line.ingredient_product_id: line.quantity for line in lines}
    costed, total, known, missing = _costed(
        quantities, _products(db, tenant_id=tenant_id, ids=set(quantities))
    )
    batch_yield = recipe.batch_yield if recipe and lines else None
    return {
        "product_id": str(product_id),
        "version": recipe.version if recipe else None,
        "effective_from": recipe.effective_from.isoformat() if recipe else None,
        "batch_yield": batch_yield,
        "lines": _jsonable(costed),
        "cost": str(total) if lines and total is not None else None,
        "known_cost": str(known),
        "ingredients_without_cost": missing,
        "cost_per_piece": (
            str(calculator.money(total / batch_yield))
            if lines and total is not None and batch_yield
            else None
        ),
    }


def save_batch_recipe(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    body: BatchRecipeWrite,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"operation": "recipes.batch", "product_id": str(product_id),
               **body.model_dump(mode="json")}
    stored = _stored_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key,
                              payload=payload)
    if stored:
        return stored
    product = (
        db.query(Product).filter_by(tenant_id=tenant_id, id=product_id).with_for_update().first()
    )
    if product is None:
        raise not_found("Producto no encontrado")
    if not product.track_inventory:
        raise bad_request(
            "Activa el control de inventario del producto para registrar lo que produces"
        )
    if product.track_lots:
        raise bad_request("Los productos con control de lotes todavía no se producen por lote")
    if body.lines:
        _validate_ingredients(
            db, tenant_id=tenant_id, ids={line.ingredient_product_id for line in body.lines},
            product_id=product_id,
        )
    latest = (
        db.query(func.max(Recipe.version))
        .filter(Recipe.tenant_id == tenant_id, Recipe.product_id == product_id)
        .scalar()
    )
    recipe = Recipe(
        tenant_id=tenant_id, product_id=product_id, version=(latest or 0) + 1, mode="batch",
        batch_yield=body.batch_yield, effective_from=_now(), created_by_user_id=user_id,
    )
    db.add(recipe)
    db.flush()
    for line in body.lines:
        db.add(RecipeLine(tenant_id=tenant_id, recipe_id=recipe.id,
                          ingredient_product_id=line.ingredient_product_id,
                          quantity=line.quantity))
    db.flush()
    body_out = batch_recipe_body(db, tenant_id=tenant_id, product_id=product_id)
    audit_service.log(
        db, action="recipes.batch_save", tenant_id=tenant_id, user_id=user_id,
        resource_type="product", resource_id=product_id,
        changes={"version": recipe.version, "batch_yield": body.batch_yield,
                 "lines": payload["lines"]},
    )
    _store_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload,
                    status_code=200, response_body=body_out)
    db.commit()
    return 200, body_out


def _batch_body(batch: ProductionBatch, *, product: Product, version: int,
                consumed: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(batch.id),
        "product_id": str(batch.product_id),
        "product_name": product.name,
        "recipe_version": version,
        "batches": batch.batches,
        "expected_quantity": batch.expected_quantity,
        "actual_quantity": batch.actual_quantity,
        "shortfall": max(0, batch.expected_quantity - batch.actual_quantity),
        "waste_reason_code": batch.waste_reason_code,
        "ingredient_cost": (
            str(batch.ingredient_cost) if batch.ingredient_cost is not None else None
        ),
        "unit_cost": str(batch.unit_cost) if batch.unit_cost is not None else None,
        "catalog_cost_updated": batch.catalog_cost_updated,
        "notes": batch.notes,
        "created_at": batch.created_at.isoformat(),
        "consumed": _jsonable(consumed),
    }


def produce(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: ProductionCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"operation": "recipes.produce", **body.model_dump(mode="json")}
    stored = _stored_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key,
                              payload=payload)
    if stored:
        return stored
    product = (
        db.query(Product).filter_by(tenant_id=tenant_id, id=body.product_id)
        .with_for_update().first()
    )
    if product is None or not product.is_active:
        raise not_found("Producto no encontrado")
    if not product.track_inventory or product.track_lots:
        raise bad_request("Este producto no se produce por lote con existencias propias")
    recipe = current_batch_recipe(db, tenant_id=tenant_id, product_id=product.id)
    lines = _recipe_lines(db, tenant_id=tenant_id, recipe=recipe)
    if not lines:
        raise bad_request("Este producto todavía no tiene receta de producción")
    expected = recipe.batch_yield * body.batches
    if body.actual_quantity < expected and body.waste_reason_code is None:
        raise bad_request("Indica el motivo de las piezas que no salieron")
    if body.actual_quantity >= expected and body.waste_reason_code is not None:
        raise bad_request("Solo se registra motivo de merma cuando salen menos piezas")
    quantities = {line.ingredient_product_id: line.quantity * body.batches for line in lines}
    ingredients = _products(db, tenant_id=tenant_id, ids=set(quantities))
    consumed, total, _, _ = _costed(quantities, ingredients)
    unit_cost = (
        calculator.money(total / body.actual_quantity)
        if total is not None and body.actual_quantity > 0
        else None
    )
    batch = ProductionBatch(
        tenant_id=tenant_id, product_id=product.id, recipe_id=recipe.id, batches=body.batches,
        expected_quantity=expected, actual_quantity=body.actual_quantity,
        waste_reason_code=body.waste_reason_code, ingredient_cost=total, unit_cost=unit_cost,
        notes=body.notes, created_by_user_id=user_id,
    )
    db.add(batch)
    db.flush()
    for ingredient_id, quantity in sorted(quantities.items(), key=lambda pair: pair[0].int):
        ingredient = ingredients[ingredient_id]
        if not ingredient.track_inventory or ingredient.track_lots:
            continue
        db.add(InventoryMovement(
            tenant_id=tenant_id, product_id=ingredient_id, production_batch_id=batch.id,
            movement_type=CONSUMPTION, lot_tracked=False, quantity_delta=-quantity,
            reason="Producción", created_by_user_id=user_id,
        ))
    if body.actual_quantity:
        db.add(InventoryMovement(
            tenant_id=tenant_id, product_id=product.id, production_batch_id=batch.id,
            movement_type=PRODUCTION, lot_tracked=False, quantity_delta=body.actual_quantity,
            reason="Producción", created_by_user_id=user_id,
        ))
    if body.update_catalog_cost and unit_cost is not None:
        # The catalog cost follows the last batch; with a purchase unit it is per that unit.
        product.cost_price = calculator.money(
            unit_cost * Decimal(product.purchase_unit_quantity or 1)
        )
        batch.catalog_cost_updated = True
    db.flush()
    body_out = _batch_body(batch, product=product, version=recipe.version, consumed=consumed)
    audit_service.log(
        db, action="recipes.produce", tenant_id=tenant_id, user_id=user_id,
        resource_type="production_batch", resource_id=batch.id,
        changes={key: body_out[key] for key in (
            "product_id", "batches", "expected_quantity", "actual_quantity",
            "waste_reason_code", "ingredient_cost", "unit_cost", "catalog_cost_updated")},
    )
    _store_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload,
                    status_code=201, response_body=body_out)
    db.commit()
    return 201, body_out


def list_batches(db: Session, *, tenant_id: UUID, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        db.query(ProductionBatch, Product, Recipe)
        .join(Product, (Product.id == ProductionBatch.product_id)
              & (Product.tenant_id == ProductionBatch.tenant_id))
        .join(Recipe, (Recipe.id == ProductionBatch.recipe_id)
              & (Recipe.tenant_id == ProductionBatch.tenant_id))
        .filter(ProductionBatch.tenant_id == tenant_id)
        .order_by(ProductionBatch.created_at.desc(), ProductionBatch.id.desc())
        .limit(limit)
        .all()
    )
    return [_batch_body(batch, product=product, version=recipe.version, consumed=[])
            for batch, product, recipe in rows]


def shortfall_between(db: Session, *, tenant_id: UUID, start: datetime, end: datetime) -> dict:
    """Pieces lost in production, valued at the batch's ingredient cost per expected piece."""
    units, known, unknown = 0, Decimal("0.00"), 0
    for batch in db.query(ProductionBatch).filter(
        ProductionBatch.tenant_id == tenant_id,
        ProductionBatch.actual_quantity < ProductionBatch.expected_quantity,
        ProductionBatch.created_at >= start,
        ProductionBatch.created_at <= end,
    ):
        lost = batch.expected_quantity - batch.actual_quantity
        units += lost
        if batch.ingredient_cost is None:
            unknown += lost
            continue
        known = calculator.money(
            known + batch.ingredient_cost * lost / Decimal(batch.expected_quantity)
        )
    return {"units": units, "value": known if unknown == 0 else None, "known_value": known,
            "units_without_cost": unknown, "complete": unknown == 0}

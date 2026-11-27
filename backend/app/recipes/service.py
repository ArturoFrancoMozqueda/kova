"""Recipes consumed at sale: versions, option adjustments, cost and stock moves.

Rules (specs/recipes/recipes_on_sale.md):
- A product prepared at sale has no stock of its own; its ingredients move.
- The version in force when the sale was rung applies, including offline
  sales synced later. Editing a recipe never rewrites past sales or costs.
- Ingredient stock never blocks a sale: a counter cannot stop serving a coffee
  because the milk count is off. Negative stock shows up as a difference.
- Option adjustments are signed per sold unit; an ingredient never goes below
  zero for one unit (a substitution removes it entirely).
- A refund never puts ingredients back; a void reverses the consumption.
"""

from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog.models import Product
from app.catalog.units import stock_unit_cost
from app.inventory.service import _store_response, _stored_response
from app.modifiers.models import ModifierOption
from app.orders.models import InventoryMovement, Order, OrderItem
from app.pricing import calculator
from app.recipes.models import ModifierOptionConsumption, Recipe, RecipeLine
from app.recipes.schemas import OptionConsumptionWrite, RecipeWrite
from app.shared.exceptions import bad_request, not_found

CONSUMPTION = "consumption"


def _now() -> datetime:
    return datetime.now(UTC)


# --- Reads ---------------------------------------------------------------


def current_recipe(
    db: Session, *, tenant_id: UUID, product_id: UUID, at: datetime | None = None
) -> Recipe | None:
    return (
        db.query(Recipe)
        .filter(
            Recipe.tenant_id == tenant_id,
            Recipe.product_id == product_id,
            Recipe.mode == "on_sale",
            Recipe.effective_from <= (at or _now()),
        )
        .order_by(Recipe.effective_from.desc(), Recipe.version.desc())
        .first()
    )


def _lines(db: Session, *, tenant_id: UUID, recipe_ids: list[UUID]) -> dict[UUID, list[RecipeLine]]:
    rows: dict[UUID, list[RecipeLine]] = defaultdict(list)
    if not recipe_ids:
        return rows
    for line in (
        db.query(RecipeLine)
        .filter(RecipeLine.tenant_id == tenant_id, RecipeLine.recipe_id.in_(recipe_ids))
        .order_by(RecipeLine.id)
    ):
        rows[line.recipe_id].append(line)
    return rows


def has_active_recipe(db: Session, *, tenant_id: UUID, product_id: UUID) -> bool:
    recipe = current_recipe(db, tenant_id=tenant_id, product_id=product_id)
    if recipe is None:
        return False
    return bool(_lines(db, tenant_id=tenant_id, recipe_ids=[recipe.id]).get(recipe.id))


def _products(db: Session, *, tenant_id: UUID, ids: set[UUID]) -> dict[UUID, Product]:
    if not ids:
        return {}
    return {
        p.id: p
        for p in db.query(Product).filter(Product.tenant_id == tenant_id, Product.id.in_(ids))
    }


def _costed(
    quantities: dict[UUID, int], products: dict[UUID, Product]
) -> tuple[list[dict[str, Any]], Decimal | None, Decimal, int]:
    lines = []
    known = Decimal("0")
    missing = 0
    for ingredient_id, quantity in quantities.items():
        product = products[ingredient_id]
        unit = stock_unit_cost(product)
        # Signed: an option that removes an ingredient lowers the cost.
        cost = None if unit is None else unit * quantity
        if cost is None:
            missing += 1
        else:
            known += cost
        lines.append(
            {
                "ingredient_product_id": ingredient_id,
                "ingredient_name": product.name,
                "stock_unit": product.stock_unit,
                "quantity": quantity,
                "cost": calculator.money(cost) if cost is not None else None,
            }
        )
    total = calculator.money(known) if missing == 0 else None
    return lines, total, calculator.money(known), missing


def recipe_body(db: Session, *, tenant_id: UUID, product_id: UUID) -> dict[str, Any]:
    product = db.query(Product).filter_by(tenant_id=tenant_id, id=product_id).first()
    if product is None:
        raise not_found("Producto no encontrado")
    recipe = current_recipe(db, tenant_id=tenant_id, product_id=product_id)
    lines = (
        _lines(db, tenant_id=tenant_id, recipe_ids=[recipe.id]).get(recipe.id, [])
        if recipe
        else []
    )
    quantities = {line.ingredient_product_id: line.quantity for line in lines}
    costed, total, known, missing = _costed(
        quantities, _products(db, tenant_id=tenant_id, ids=set(quantities))
    )
    return {
        "product_id": str(product_id),
        "version": recipe.version if recipe else None,
        "effective_from": recipe.effective_from.isoformat() if recipe else None,
        "lines": _jsonable(costed),
        # No recipe means the catalog cost applies; an incomplete one is unknown, never $0.
        "cost": str(total) if lines and total is not None else None,
        "known_cost": str(known),
        "ingredients_without_cost": missing,
    }


def option_body(db: Session, *, tenant_id: UUID, option_id: UUID) -> dict[str, Any]:
    _option(db, tenant_id=tenant_id, option_id=option_id)
    rows = (
        db.query(ModifierOptionConsumption)
        .filter(
            ModifierOptionConsumption.tenant_id == tenant_id,
            ModifierOptionConsumption.modifier_option_id == option_id,
        )
        .order_by(ModifierOptionConsumption.id)
        .all()
    )
    quantities = {row.ingredient_product_id: row.quantity for row in rows}
    products = _products(db, tenant_id=tenant_id, ids=set(quantities))
    costed, total, _, _ = _costed(quantities, products)
    return {
        "modifier_option_id": str(option_id),
        "lines": _jsonable(costed),
        "cost_delta": str(total) if total is not None else None,
    }


def _jsonable(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            **line,
            "ingredient_product_id": str(line["ingredient_product_id"]),
            "cost": str(line["cost"]) if line["cost"] is not None else None,
        }
        for line in lines
    ]


# --- Writes --------------------------------------------------------------


def _validate_ingredients(
    db: Session, *, tenant_id: UUID, ids: set[UUID], product_id: UUID | None = None
) -> None:
    found = _products(db, tenant_id=tenant_id, ids=ids)
    if len(found) != len(ids) or any(not p.is_active for p in found.values()):
        raise bad_request("Selecciona insumos activos de este negocio")
    if product_id in found:
        raise bad_request("Este producto no puede ser insumo de sí mismo")
    if any(p.track_lots for p in found.values()):
        raise bad_request(
            "Los insumos con control de lotes todavía no se pueden usar en recetas"
        )


def save_recipe(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    body: RecipeWrite,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"operation": "recipes.save", "product_id": str(product_id),
               **body.model_dump(mode="json")}
    stored = _stored_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key,
                              payload=payload)
    if stored:
        return stored
    # Locking the product serializes version numbers per product.
    product = (
        db.query(Product).filter_by(tenant_id=tenant_id, id=product_id).with_for_update().first()
    )
    if product is None:
        raise not_found("Producto no encontrado")
    if body.lines:
        if not product.is_sellable:
            raise bad_request("Los insumos no llevan receta de venta")
        if product.track_inventory:
            raise bad_request(
                "Este producto lleva existencias propias. Desactiva el control de inventario "
                "para descontar sus insumos al venderlo."
            )
        _validate_ingredients(
            db, tenant_id=tenant_id, ids={line.ingredient_product_id for line in body.lines},
            product_id=product_id,
        )
    latest = (
        db.query(func.max(Recipe.version))
        .filter(Recipe.tenant_id == tenant_id, Recipe.product_id == product_id)
        .scalar()
    )
    if latest is None and not body.lines:
        body_out = recipe_body(db, tenant_id=tenant_id, product_id=product_id)
        _store_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key,
                        payload=payload, status_code=200, response_body=body_out)
        db.commit()
        return 200, body_out
    recipe = Recipe(
        tenant_id=tenant_id,
        product_id=product_id,
        version=(latest or 0) + 1,
        mode="on_sale",
        effective_from=_now(),
        created_by_user_id=user_id,
    )
    db.add(recipe)
    db.flush()
    for line in body.lines:
        db.add(
            RecipeLine(
                tenant_id=tenant_id,
                recipe_id=recipe.id,
                ingredient_product_id=line.ingredient_product_id,
                quantity=line.quantity,
            )
        )
    db.flush()
    body_out = recipe_body(db, tenant_id=tenant_id, product_id=product_id)
    audit_service.log(
        db, action="recipes.save", tenant_id=tenant_id, user_id=user_id,
        resource_type="product", resource_id=product_id,
        changes={"version": recipe.version, "lines": payload["lines"]},
    )
    _store_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload,
                    status_code=200, response_body=body_out)
    db.commit()
    return 200, body_out


def _option(db: Session, *, tenant_id: UUID, option_id: UUID, lock: bool = False) -> ModifierOption:
    query = db.query(ModifierOption).filter_by(tenant_id=tenant_id, id=option_id)
    option = (query.with_for_update() if lock else query).first()
    if option is None:
        raise not_found("Opción no encontrada")
    return option


def save_option_consumption(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    option_id: UUID,
    body: OptionConsumptionWrite,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"operation": "recipes.option", "option_id": str(option_id),
               **body.model_dump(mode="json")}
    stored = _stored_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key,
                              payload=payload)
    if stored:
        return stored
    _option(db, tenant_id=tenant_id, option_id=option_id, lock=True)
    if body.lines:
        _validate_ingredients(
            db, tenant_id=tenant_id, ids={line.ingredient_product_id for line in body.lines}
        )
    db.query(ModifierOptionConsumption).filter(
        ModifierOptionConsumption.tenant_id == tenant_id,
        ModifierOptionConsumption.modifier_option_id == option_id,
    ).delete(synchronize_session=False)
    for line in body.lines:
        db.add(
            ModifierOptionConsumption(
                tenant_id=tenant_id,
                modifier_option_id=option_id,
                ingredient_product_id=line.ingredient_product_id,
                quantity=line.quantity,
            )
        )
    db.flush()
    body_out = option_body(db, tenant_id=tenant_id, option_id=option_id)
    audit_service.log(
        db, action="recipes.option_consumption", tenant_id=tenant_id, user_id=user_id,
        resource_type="modifier_option", resource_id=option_id,
        changes={"lines": payload["lines"]},
    )
    _store_response(db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload,
                    status_code=200, response_body=body_out)
    db.commit()
    return 200, body_out


# --- Sale integration ----------------------------------------------------


def consume_for_sale(
    db: Session,
    *,
    tenant_id: UUID,
    order: Order,
    lines: list[tuple[OrderItem, Product, list[UUID]]],
) -> None:
    """Move ingredients and freeze the line cost for each sold line.

    ``lines`` are the sale's order items with their product and the chosen
    modifier option ids. Call once, after the items exist and before flush of
    the order's response, in the same transaction as the sale.
    """
    if not lines:
        return
    at = order.occurred_at or order.created_at or _now()
    # One query for the whole cart: the version in force per product at ring time.
    recipes = {
        recipe.product_id: recipe
        for recipe in db.query(Recipe)
        .filter(
            Recipe.tenant_id == tenant_id,
            Recipe.product_id.in_({product.id for _, product, _ in lines}),
            Recipe.mode == "on_sale",
            Recipe.effective_from <= at,
        )
        .order_by(Recipe.product_id, Recipe.effective_from.desc(), Recipe.version.desc())
        .distinct(Recipe.product_id)
    }
    recipe_lines = _lines(db, tenant_id=tenant_id, recipe_ids=[r.id for r in recipes.values()])
    option_ids = {option for _, _, options in lines for option in options}
    adjustments: dict[UUID, list[ModifierOptionConsumption]] = defaultdict(list)
    if option_ids:
        for row in db.query(ModifierOptionConsumption).filter(
            ModifierOptionConsumption.tenant_id == tenant_id,
            ModifierOptionConsumption.modifier_option_id.in_(option_ids),
        ):
            adjustments[row.modifier_option_id].append(row)
    ingredient_ids = {line.ingredient_product_id for rows in recipe_lines.values() for line in rows}
    ingredient_ids |= {row.ingredient_product_id for rows in adjustments.values() for row in rows}
    if not ingredient_ids:
        return
    ingredients = _products(db, tenant_id=tenant_id, ids=ingredient_ids)

    for item, product, options in lines:
        recipe = recipes.get(product.id)
        base = recipe_lines.get(recipe.id, []) if recipe else []
        option_rows = [row for option in options for row in adjustments.get(option, [])]
        if not base and not option_rows:
            continue
        per_unit: dict[UUID, int] = defaultdict(int)
        for line in base:
            per_unit[line.ingredient_product_id] += line.quantity
        option_only: dict[UUID, int] = defaultdict(int)
        for row in option_rows:
            per_unit[row.ingredient_product_id] += row.quantity
            option_only[row.ingredient_product_id] += row.quantity
        used = {ingredient: qty for ingredient, qty in per_unit.items() if qty > 0}
        for ingredient_id, quantity in sorted(used.items(), key=lambda pair: pair[0].int):
            ingredient = ingredients[ingredient_id]
            # Lot-tracked ingredients are rejected when a recipe is saved; one
            # switched to lots later keeps its cost but is not moved here.
            if not ingredient.track_inventory or ingredient.track_lots:
                continue
            db.add(
                InventoryMovement(
                    tenant_id=tenant_id,
                    product_id=ingredient_id,
                    order_id=order.id,
                    order_item_id=item.id,
                    movement_type=CONSUMPTION,
                    lot_tracked=False,
                    quantity_delta=-quantity * item.quantity,
                    reason="Receta",
                )
            )
        if base:
            _, total, _, _ = _costed(used, ingredients)
            item.unit_cost = total
        elif item.unit_cost is not None:
            added = {k: v for k, v in option_only.items() if v > 0}
            _, delta, _, _ = _costed(added, ingredients)
            item.unit_cost = None if delta is None else calculator.money(item.unit_cost + delta)
    db.flush()


def reverse_consumption(db: Session, *, tenant_id: UUID, order_id: UUID, user_id: UUID) -> None:
    """A void means the sale did not happen: put consumed ingredients back."""
    rows = (
        db.query(
            InventoryMovement.product_id,
            InventoryMovement.order_item_id,
            func.sum(InventoryMovement.quantity_delta),
        )
        .filter(
            InventoryMovement.tenant_id == tenant_id,
            InventoryMovement.order_id == order_id,
            InventoryMovement.movement_type == CONSUMPTION,
        )
        .group_by(InventoryMovement.product_id, InventoryMovement.order_item_id)
        .all()
    )
    for product_id, order_item_id, net in rows:
        if net:
            db.add(
                InventoryMovement(
                    tenant_id=tenant_id,
                    product_id=product_id,
                    order_id=order_id,
                    order_item_id=order_item_id,
                    movement_type=CONSUMPTION,
                    lot_tracked=False,
                    quantity_delta=-int(net),
                    reason="Anulación de venta",
                    created_by_user_id=user_id,
                )
            )
    db.flush()

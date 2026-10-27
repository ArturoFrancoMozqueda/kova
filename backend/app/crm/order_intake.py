"""Explicit, atomic conversion of structured intake to an unreserved operational order."""

import hashlib
import json
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException

from app.catalog.models import Product
from app.crm import engagement
from app.crm.engagement_models import CatalogRequest
from app.crm.engagement_schemas import CatalogOrderPreview
from app.crm.models import now
from app.crm.service import _customer, _request
from app.customer_orders import repository as order_repo
from app.customer_orders import service as orders
from app.customer_orders.schemas import CustomerOrderCreate, CustomerOrderItemCreate
from app.inventory.repository import stock_on_hand_for_products
from app.modifiers.service import validate_and_price_modifiers
from app.shared.exceptions import bad_request, conflict, not_found


def _get_request(db, tenant_id, request_id, *, lock=False):
    from app.branches.scope import active_branch_id

    query = db.query(CatalogRequest).filter_by(
        tenant_id=tenant_id, branch_id=active_branch_id(db, tenant_id), id=request_id,
    )
    row = (query.with_for_update() if lock else query).first()
    if row is None:
        raise not_found("Solicitud no encontrada")
    return row


def _preview(db, row, *, lock=False):
    ids = {UUID(line["product_id"]) for line in row.order_lines or []}
    products = {}
    for product_id in sorted(ids, key=lambda value: value.int):
        query = db.query(Product).filter_by(tenant_id=row.tenant_id, id=product_id)
        product = (query.with_for_update() if lock else query).first()
        if product is not None:
            products[product.id] = product
    stock = stock_on_hand_for_products(db, tenant_id=row.tenant_id, product_ids=list(ids))
    reserved = order_repo.active_reserved_for_products(
        db, tenant_id=row.tenant_id, product_ids=list(ids),
    )
    issues, items = [], []
    if row.status != "new":
        issues.append("Esta solicitud ya fue revisada. Consulta el registro vinculado.")
    if not row.order_lines:
        issues.append(
            "Esta consulta no incluye cantidades estructuradas; revísala de forma manual.",
        )
    for captured in row.order_lines or []:
        product_id = UUID(captured["product_id"])
        product = products.get(product_id)
        if product is None or not product.is_active:
            issues.append(f"{captured['product_name']}: el producto ya no está disponible.")
            continue
        quantity = captured["quantity"]
        available = int(stock.get(product_id, 0) - reserved.get(product_id, 0)) if (
            product.track_inventory
        ) else None
        if available is not None and available < quantity:
            issues.append(
                f"{product.name}: no hay existencias suficientes para la cantidad solicitada.",
            )
        try:
            validate_and_price_modifiers(
                db, tenant_id=row.tenant_id, product_id=product.id, modifier_option_ids=[],
            )
        except HTTPException:
            issues.append(
                f"{product.name}: revisa las opciones obligatorias antes de crear el pedido.",
            )
        items.append({
            "product_id": str(product.id), "product_name": product.name, "quantity": quantity,
            "unit_price_amount": str(product.price_amount),
            "line_total_amount": str(product.price_amount * quantity),
            "available_quantity": available,
        })
    snapshot = {
        "request_id": str(row.id), "version": row.version, "status": row.status,
        "items": items, "issues": issues,
    }
    fingerprint = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    return CatalogOrderPreview(
        request_id=row.id, version=row.version, items=items,
        total_amount=sum((Decimal(item["line_total_amount"]) for item in items), Decimal("0.00")),
        can_accept=not issues, issues=issues, preview_fingerprint=fingerprint,
        customer_order_id=row.customer_order_id,
    ).model_dump(mode="json")


def preview(db, tenant_id, request_id):
    return _preview(db, _get_request(db, tenant_id, request_id))


def accept(db, tenant_id, user_id, request_id, body, key):
    fingerprint, replay = _request(db, tenant_id, key, f"catalog-order:{request_id}", body)
    if replay:
        return replay.response_status, replay.response_body
    row = _get_request(db, tenant_id, request_id, lock=True)
    if row.version != body.expected_version or row.status != "new":
        raise conflict("La solicitud cambió. Actualiza antes de continuar")
    reviewed = _preview(db, row, lock=True)
    if reviewed["preview_fingerprint"] != body.preview_fingerprint:
        raise conflict("Los precios o la disponibilidad cambiaron. Revisa el pedido de nuevo")
    if not reviewed["can_accept"]:
        raise bad_request("Revisa los productos y existencias antes de crear el pedido")
    customer = _customer(db, tenant_id, body.customer_id, lock=True)
    if not customer.is_active:
        raise bad_request("Reactiva al cliente antes de crear su pedido")
    # A derived private key has a separate namespace and participates in this
    # transaction. A failure before linking rolls back both response records.
    order_key = f"catalog-order:{request_id}:{hashlib.sha256(key.encode()).hexdigest()}"
    _, order = orders.create_customer_order(
        db, tenant_id=tenant_id, user_id=user_id,
        body=CustomerOrderCreate(
            customer_id=customer.id, customer_name=customer.name,
            source_channel="counter" if row.origin == "in_store" else "other",
            fulfillment_type="pickup", note=f"Solicitud del menú {row.id}",
            items=[CustomerOrderItemCreate(
                product_id=item["product_id"], quantity=item["quantity"],
            ) for item in reviewed["items"]],
        ),
        idempotency_key=order_key, commit=False,
    )
    row.customer_id, row.customer_order_id = customer.id, UUID(order["id"])
    row.status, row.resolved_at = "accepted", now()
    row.version += 1
    db.flush()
    result = {"request": engagement.request_response(row), "customer_order": order}
    return engagement._finish(
        db, tenant_id, user_id, key, fingerprint, row, result, "crm.request.order_created", 201,
    )

import hashlib
import json
import re
import secrets
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog import repository as repo
from app.catalog.models import Category, Product
from app.catalog.schemas import CategoryCreate, CategoryUpdate, ProductCreate, ProductUpdate
from app.idempotency import service as idempotency_service
from app.shared.exceptions import bad_request, not_found

_SKU_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _category_prefix(db: Session, *, tenant_id: UUID, category_id: UUID | None) -> str:
    if category_id:
        category = repo.get_category(db, tenant_id=tenant_id, category_id=category_id)
        if category and category.name:
            letters = re.sub(r"[^A-Z]", "", category.name.upper())
            if len(letters) >= 3:
                return letters[:3]
    return "PRD"


def _generate_sku(db: Session, *, tenant_id: UUID, category_id: UUID | None) -> str:
    prefix = _category_prefix(db, tenant_id=tenant_id, category_id=category_id)
    for _ in range(8):
        suffix = "".join(secrets.choice(_SKU_ALPHABET) for _ in range(5))
        candidate = f"{prefix}-{suffix}"
        if not repo.get_product_by_sku(db, tenant_id=tenant_id, sku=candidate):
            return candidate
    raise bad_request("Could not generate a unique SKU; please specify one")


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


def _category_body(category: Category) -> dict[str, Any]:
    return {
        "id": str(category.id),
        "tenant_id": str(category.tenant_id),
        "name": category.name,
        "description": category.description,
        "sort_order": category.sort_order,
        "is_active": category.is_active,
    }


def _product_body(product: Product) -> dict[str, Any]:
    return {
        "id": str(product.id),
        "tenant_id": str(product.tenant_id),
        "category_id": str(product.category_id) if product.category_id else None,
        "name": product.name,
        "description": product.description,
        "sku": product.sku,
        "price_amount": str(product.price_amount),
        "cost_price": str(product.cost_price) if product.cost_price is not None else None,
        "track_inventory": product.track_inventory,
        "low_stock_threshold": product.low_stock_threshold,
        "image_url": product.image_url,
        "image_position_x": product.image_position_x,
        "image_position_y": product.image_position_y,
        "image_zoom": product.image_zoom,
        "is_active": product.is_active,
    }


def list_categories(db: Session, *, tenant_id: UUID) -> list[Category]:
    return repo.list_categories(db, tenant_id=tenant_id)


def create_category(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: CategoryCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    if repo.get_category_by_name(db, tenant_id=tenant_id, name=body.name):
        raise bad_request("Category name already exists")
    category = repo.create_category(
        db,
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        sort_order=body.sort_order,
    )
    response_body = _category_body(category)
    audit_service.log(
        db,
        action="catalog.category.create",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="category",
        resource_id=category.id,
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


def update_category(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    category_id: UUID,
    body: CategoryUpdate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json", exclude_unset=True)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    category = repo.get_category(db, tenant_id=tenant_id, category_id=category_id)
    if not category:
        raise not_found("Category not found")
    if body.name is not None and body.name != category.name:
        duplicate = repo.get_category_by_name(db, tenant_id=tenant_id, name=body.name)
        if duplicate:
            raise bad_request("Category name already exists")
        category.name = body.name
    for field in ("description", "sort_order", "is_active"):
        value = getattr(body, field)
        if field in body.model_fields_set:
            setattr(category, field, value)
    db.flush()
    response_body = _category_body(category)
    audit_service.log(
        db,
        action="catalog.category.update",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="category",
        resource_id=category.id,
        changes=payload,
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


def deactivate_category(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    category_id: UUID,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"is_active": False}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    category = repo.get_category(db, tenant_id=tenant_id, category_id=category_id)
    if not category:
        raise not_found("Category not found")
    category.is_active = False
    db.flush()
    response_body = _category_body(category)
    audit_service.log(
        db,
        action="catalog.category.deactivate",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="category",
        resource_id=category.id,
        changes=payload,
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


def list_products(db: Session, *, tenant_id: UUID) -> list[Product]:
    return repo.list_products(db, tenant_id=tenant_id)


def _ensure_category(db: Session, *, tenant_id: UUID, category_id: UUID | None) -> None:
    if not category_id:
        return
    category = repo.get_category(db, tenant_id=tenant_id, category_id=category_id)
    if not category or not category.is_active:
        raise not_found("Category not found")


def create_product(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    body: ProductCreate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json")
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    _ensure_category(db, tenant_id=tenant_id, category_id=body.category_id)
    if body.sku and repo.get_product_by_sku(db, tenant_id=tenant_id, sku=body.sku):
        raise bad_request("Product SKU already exists")
    sku = body.sku
    if not sku or not sku.strip():
        sku = _generate_sku(db, tenant_id=tenant_id, category_id=body.category_id)
    product = repo.create_product(
        db,
        tenant_id=tenant_id,
        category_id=body.category_id,
        name=body.name,
        description=body.description,
        sku=sku,
        price_amount=body.price_amount,
        cost_price=body.cost_price,
        track_inventory=body.track_inventory,
        low_stock_threshold=body.low_stock_threshold,
        image_position_x=body.image_position_x,
        image_position_y=body.image_position_y,
        image_zoom=body.image_zoom,
    )
    response_body = _product_body(product)
    audit_service.log(
        db,
        action="catalog.product.create",
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


def update_product(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    body: ProductUpdate,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = body.model_dump(mode="json", exclude_unset=True)
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    product = repo.get_product(db, tenant_id=tenant_id, product_id=product_id)
    if not product:
        raise not_found("Product not found")
    if "category_id" in body.model_fields_set:
        _ensure_category(db, tenant_id=tenant_id, category_id=body.category_id)
        product.category_id = body.category_id
    if body.sku is not None and body.sku != product.sku:
        duplicate = repo.get_product_by_sku(db, tenant_id=tenant_id, sku=body.sku)
        if duplicate:
            raise bad_request("Product SKU already exists")
        product.sku = body.sku
    for field in (
        "name",
        "description",
        "price_amount",
        "cost_price",
        "track_inventory",
        "low_stock_threshold",
        "image_position_x",
        "image_position_y",
        "image_zoom",
        "is_active",
    ):
        if field in body.model_fields_set:
            setattr(product, field, getattr(body, field))
    db.flush()
    response_body = _product_body(product)
    audit_service.log(
        db,
        action="catalog.product.update",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="product",
        resource_id=product.id,
        changes=payload,
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


def deactivate_product(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    product_id: UUID,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    payload = {"is_active": False}
    stored = _stored_response(
        db, tenant_id=tenant_id, idempotency_key=idempotency_key, payload=payload
    )
    if stored:
        return stored
    product = repo.get_product(db, tenant_id=tenant_id, product_id=product_id)
    if not product:
        raise not_found("Product not found")
    product.is_active = False
    db.flush()
    response_body = _product_body(product)
    audit_service.log(
        db,
        action="catalog.product.deactivate",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="product",
        resource_id=product.id,
        changes=payload,
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

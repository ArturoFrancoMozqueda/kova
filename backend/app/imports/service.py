import csv
import hashlib
import io
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.audit import service as audit_service
from app.catalog import repository as catalog_repo
from app.idempotency import service as idempotency_service
from app.inventory import repository as inventory_repo
from app.shared.exceptions import bad_request
from app.shared.validation import reject_html

MAX_IMPORT_ROWS = 1000
TEMPLATE_COLUMNS = (
    "nombre",
    "sku",
    "precio",
    "costo",
    "categoria",
    "control_inventario",
    "stock_inicial",
    "umbral_stock",
)
TEMPLATE_CSV = ",".join(TEMPLATE_COLUMNS) + "\r\n"


def _decimal(value: str, *, label: str, required: bool) -> tuple[Decimal | None, str | None]:
    if not value:
        return (None, f"{label} es obligatorio") if required else (None, None)
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        return None, f"{label} debe ser un número válido"
    if (
        not parsed.is_finite()
        or parsed < 0
        or parsed.as_tuple().exponent < -2
        or parsed >= Decimal("10000000000")
    ):
        return None, f"{label} debe ser positivo y tener máximo dos decimales"
    return parsed.quantize(Decimal("0.01")), None


def _integer(value: str, *, label: str) -> tuple[int | None, str | None]:
    if not value:
        return None, None
    try:
        parsed = int(value)
    except ValueError:
        return None, f"{label} debe ser un número entero"
    if parsed < 0:
        return None, f"{label} no puede ser negativo"
    return parsed, None


def _boolean(value: str) -> tuple[bool, str | None]:
    normalized = value.strip().lower()
    if normalized in {"", "no", "false", "0"}:
        return False, None
    if normalized in {"sí", "si", "true", "1"}:
        return True, None
    return False, "control_inventario debe ser sí o no"


def _decode(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise bad_request("El CSV debe estar codificado en UTF-8") from exc


def validate_catalog_csv(db: Session, *, tenant_id: UUID, content: bytes) -> dict[str, Any]:
    if not content.strip():
        raise bad_request("El archivo CSV está vacío")
    text = _decode(content)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = [str(value or "").strip().lower() for value in (reader.fieldnames or [])]
    if not headers:
        raise bad_request("El CSV no contiene encabezados")
    if len(headers) != len(set(headers)):
        raise bad_request("El CSV contiene encabezados repetidos")
    missing = [column for column in ("nombre", "precio") if column not in headers]
    unknown = [column for column in headers if column not in TEMPLATE_COLUMNS]
    if missing or unknown:
        details = []
        if missing:
            details.append(f"faltan columnas: {', '.join(missing)}")
        if unknown:
            details.append(f"columnas no reconocidas: {', '.join(unknown)}")
        raise bad_request("Encabezados inválidos; " + "; ".join(details))

    existing_skus = {
        product.sku.upper()
        for product in catalog_repo.list_products(db, tenant_id=tenant_id, include_inactive=True)
        if product.sku
    }
    inactive_categories = {
        category.name.casefold()
        for category in catalog_repo.list_categories(
            db, tenant_id=tenant_id, include_inactive=True
        )
        if not category.is_active
    }
    seen_skus: set[str] = set()
    rows = []
    for row_number, raw in enumerate(reader, start=2):
        if len(rows) >= MAX_IMPORT_ROWS:
            raise bad_request(f"El CSV admite máximo {MAX_IMPORT_ROWS} productos")
        values = {
            str(key or "").strip().lower(): str(value or "").strip()
            for key, value in raw.items()
        }
        if not any(values.values()):
            continue
        errors: list[str] = []
        name = values.get("nombre", "").strip()
        if not name:
            errors.append("nombre es obligatorio")
        elif len(name) > 160:
            errors.append("nombre admite máximo 160 caracteres")
        else:
            try:
                reject_html(name)
            except ValueError as exc:
                errors.append(str(exc))
        sku = values.get("sku", "").upper() or None
        if sku and len(sku) > 100:
            errors.append("sku admite máximo 100 caracteres")
        if sku and sku in existing_skus:
            errors.append("sku ya existe en el catálogo")
        if sku and sku in seen_skus:
            errors.append("sku está repetido en el archivo")
        if sku:
            seen_skus.add(sku)
        price, price_error = _decimal(values.get("precio", ""), label="precio", required=True)
        cost, cost_error = _decimal(values.get("costo", ""), label="costo", required=False)
        if price_error:
            errors.append(price_error)
        if cost_error:
            errors.append(cost_error)
        category = values.get("categoria", "").strip() or None
        if category and len(category) > 120:
            errors.append("categoria admite máximo 120 caracteres")
        if category and category.casefold() in inactive_categories:
            errors.append("categoria existe pero está desactivada")
        track_inventory, inventory_error = _boolean(values.get("control_inventario", ""))
        if inventory_error:
            errors.append(inventory_error)
        initial_stock, stock_error = _integer(
            values.get("stock_inicial", ""), label="stock_inicial"
        )
        threshold, threshold_error = _integer(values.get("umbral_stock", ""), label="umbral_stock")
        if stock_error:
            errors.append(stock_error)
        if threshold_error:
            errors.append(threshold_error)
        if (initial_stock or 0) > 0 and not track_inventory:
            errors.append("activa control_inventario para cargar stock_inicial")
        if threshold is not None and not track_inventory:
            errors.append("activa control_inventario para definir umbral_stock")
        normalized = {
            "name": name,
            "sku": sku,
            "price_amount": str(price) if price is not None else None,
            "cost_price": str(cost) if cost is not None else None,
            "category_name": category,
            "track_inventory": track_inventory,
            "initial_stock": initial_stock or 0,
            "low_stock_threshold": threshold,
        }
        rows.append(
            {
                "row_number": row_number,
                "status": "error" if errors else "valid",
                "normalized": normalized,
                "errors": errors,
            }
        )
    if not rows:
        raise bad_request("El CSV no contiene productos")
    error_rows = sum(1 for row in rows if row["errors"])
    return {
        "dry_run": True,
        "total_rows": len(rows),
        "valid_rows": len(rows) - error_rows,
        "error_rows": error_rows,
        "rows": rows,
        "created_products": 0,
        "created_categories": 0,
        "initial_stock_movements": 0,
    }


def commit_catalog_csv(
    db: Session,
    *,
    tenant_id: UUID,
    user_id: UUID,
    content: bytes,
    idempotency_key: str,
) -> tuple[int, dict[str, Any]]:
    request_hash = hashlib.sha256(content).hexdigest()
    existing = idempotency_service.get(db, tenant_id=tenant_id, key=idempotency_key)
    if existing:
        if existing.request_hash != request_hash:
            raise bad_request("Idempotency key reused with different request body")
        return existing.response_status or 200, existing.response_body or {}
    result = validate_catalog_csv(db, tenant_id=tenant_id, content=content)
    if result["error_rows"]:
        raise bad_request("Corrige todos los errores del CSV antes de confirmar")
    categories = {
        category.name.casefold(): category
        for category in catalog_repo.list_categories(db, tenant_id=tenant_id)
    }
    created_categories = 0
    initial_movements = 0
    for row in result["rows"]:
        values = row["normalized"]
        category_id = None
        category_name = values["category_name"]
        if category_name:
            category = categories.get(category_name.casefold())
            if not category:
                category = catalog_repo.create_category(
                    db,
                    tenant_id=tenant_id,
                    name=category_name,
                    description=None,
                    sort_order=0,
                )
                categories[category_name.casefold()] = category
                created_categories += 1
            category_id = category.id
        product = catalog_repo.create_product(
            db,
            tenant_id=tenant_id,
            category_id=category_id,
            name=values["name"],
            description=None,
            sku=values["sku"],
            price_amount=Decimal(values["price_amount"]),
            cost_price=(Decimal(values["cost_price"]) if values["cost_price"] else None),
            track_inventory=values["track_inventory"],
            low_stock_threshold=values["low_stock_threshold"],
            image_position_x=50,
            image_position_y=50,
            image_zoom=1.0,
        )
        if values["initial_stock"] > 0:
            inventory_repo.create_movement(
                db,
                tenant_id=tenant_id,
                product_id=product.id,
                user_id=user_id,
                movement_type="adjustment",
                quantity_delta=values["initial_stock"],
                reason="Importación CSV: stock inicial",
            )
            initial_movements += 1
    response = {
        **result,
        "dry_run": False,
        "created_products": result["valid_rows"],
        "created_categories": created_categories,
        "initial_stock_movements": initial_movements,
    }
    audit_service.log(
        db,
        action="catalog.import",
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="catalog_import",
        resource_id=None,
        changes={
            key: response[key]
            for key in (
                "created_products",
                "created_categories",
                "initial_stock_movements",
            )
        },
    )
    idempotency_service.store(
        db,
        tenant_id=tenant_id,
        key=idempotency_key,
        request_hash=request_hash,
        response_status=201,
        response_body=response,
    )
    db.commit()
    return 201, response

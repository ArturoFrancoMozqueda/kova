"""Catalog export in the import template's columns, so a file can be edited and imported back."""

import csv
import io
from decimal import Decimal
from uuid import UUID

from openpyxl import Workbook
from sqlalchemy.orm import Session

from app.catalog.models import Category, Product
from app.imports.service import TEMPLATE_COLUMNS
from app.inventory import repository as inventory_repo


def _safe(value: object) -> object:
    """Keep spreadsheet apps from running a cell as a formula (=, +, -, @)."""
    if value is None:
        return ""
    if isinstance(value, (Decimal, int)) and not isinstance(value, bool):
        return value
    rendered = str(value)
    formula = rendered.lstrip(" \t\r\n").startswith(("=", "+", "-", "@"))
    return f"'{rendered}" if formula else rendered


def catalog_rows(db: Session, *, tenant_id: UUID) -> list[list[object]]:
    """Active products, one row each; stock_inicial carries today's stock on hand."""
    products = (
        db.query(Product)
        .filter(Product.tenant_id == tenant_id, Product.is_active.is_(True))
        .order_by(Product.name, Product.id)
        .all()
    )
    categories = dict(
        db.query(Category.id, Category.name).filter(Category.tenant_id == tenant_id).all()
    )
    stock = inventory_repo.stock_on_hand_for_products(
        db, tenant_id=tenant_id,
        product_ids=[product.id for product in products if product.track_inventory],
    )
    rows = []
    for product in products:
        values = {
            "nombre": product.name,
            "sku": product.sku,
            "precio": product.price_amount,
            "costo": product.cost_price,
            "categoria": categories.get(product.category_id),
            "control_inventario": "sí" if product.track_inventory else "no",
            "stock_inicial": max(stock.get(product.id, 0), 0) if product.track_inventory else None,
            "umbral_stock": product.low_stock_threshold if product.track_inventory else None,
            "codigo_barras": product.barcode,
            "tipo": "producto" if product.is_sellable else "insumo",
            "unidad": product.stock_unit,
        }
        rows.append([_safe(values[column]) for column in TEMPLATE_COLUMNS])
    return rows


def to_csv(rows: list[list[object]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(TEMPLATE_COLUMNS)
    writer.writerows([["" if value is None else value for value in row] for row in rows])
    # Excel reads the BOM as UTF-8 and keeps the accents, as with the template.
    return "﻿" + buffer.getvalue()


def to_xlsx(rows: list[list[object]]) -> bytes:
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet("Catálogo")
    sheet.append(list(TEMPLATE_COLUMNS))
    for row in rows:
        sheet.append([None if value == "" else value for value in row])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()

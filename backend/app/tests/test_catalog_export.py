"""Catalog export: the import template's columns, so the file can be edited and imported back."""

import csv
import io
from uuid import UUID, uuid4

import pytest
from openpyxl import load_workbook

from app.auth.models import Membership
from app.catalog.models import Product
from app.imports.service import TEMPLATE_COLUMNS
from app.tests.test_catalog_import import _login

pytestmark = pytest.mark.usefixtures("fast_business_auth")

CATALOG = (
    "nombre,sku,precio,costo,categoria,control_inventario,stock_inicial,umbral_stock,"
    "codigo_barras,tipo,unidad\n"
    "Concha,CON-1,18.00,8.00,Pan dulce,sí,20,5,7501000000011,producto,pza\n"
    "Leche entera,LEC-1,0.00,25.00,Insumos,sí,3000,500,,insumo,ml\n"
    "=SUMA(A1),FORM-1,10.00,,,no,,,,producto,pza\n"
)


def _import(client) -> None:
    response = client.post("/api/v1/catalog/import?dry_run=false", content=CATALOG.encode(),
                           headers={"Content-Type": "text/csv", "Idempotency-Key": str(uuid4())})
    assert response.status_code == 201, response.text


def test_export_matches_the_template_and_can_be_imported_back(client, db) -> None:
    _login(client, f"export-{uuid4().hex}@example.com")
    _import(client)
    response = client.get("/api/v1/catalog/export")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert "catalogo-kova-" in response.headers["content-disposition"]
    text = response.content.decode("utf-8")
    assert text.startswith("﻿")
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    assert list(rows[0]) == list(TEMPLATE_COLUMNS)
    by_sku = {row["sku"]: row for row in rows}
    assert by_sku["CON-1"] == {
        "nombre": "Concha", "sku": "CON-1", "precio": "18.00", "costo": "8.00",
        "categoria": "Pan dulce", "control_inventario": "sí", "stock_inicial": "20",
        "umbral_stock": "5", "codigo_barras": "7501000000011", "tipo": "producto", "unidad": "pza",
    }
    assert (by_sku["LEC-1"]["tipo"], by_sku["LEC-1"]["unidad"]) == ("insumo", "ml")
    # A name that looks like a formula is kept as text, never executed.
    assert by_sku["FORM-1"]["nombre"] == "'=SUMA(A1)"
    assert by_sku["FORM-1"]["control_inventario"] == "no"

    # The exported file is valid input for another business.
    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _login(client, f"export-copy-{uuid4().hex}@example.com")
    preview = client.post("/api/v1/catalog/import?dry_run=true", content=response.content,
                          headers={"Content-Type": "text/csv"})
    assert preview.status_code == 200, preview.text
    assert preview.json()["valid_rows"] == 3


def test_xlsx_export_has_the_same_rows(client, db) -> None:
    _login(client, f"export-xlsx-{uuid4().hex}@example.com")
    _import(client)
    response = client.get("/api/v1/catalog/export", params={"format": "xlsx"})
    assert response.status_code == 200, response.text
    sheet = load_workbook(io.BytesIO(response.content), read_only=True).active
    rows = list(sheet.iter_rows(values_only=True))
    assert rows[0] == TEMPLATE_COLUMNS
    assert {row[1] for row in rows[1:]} == {"CON-1", "LEC-1", "FORM-1"}
    formula_row = next(row for row in rows[1:] if row[1] == "FORM-1")
    assert formula_row[0] == "'=SUMA(A1)"


def test_export_leaves_out_inactive_products_and_other_businesses(client, db) -> None:
    signup = _login(client, f"export-scope-{uuid4().hex}@example.com")
    _import(client)
    concha = db.query(Product).filter(Product.tenant_id == UUID(signup["tenant_id"]),
                                      Product.sku == "CON-1").one()
    concha.is_active = False
    db.commit()
    skus = {row["sku"] for row in csv.DictReader(io.StringIO(
        client.get("/api/v1/catalog/export").content.decode("utf-8").lstrip("﻿")))}
    assert skus == {"LEC-1", "FORM-1"}

    client.post("/api/v1/auth/logout")
    client.cookies.clear()
    _login(client, f"export-other-{uuid4().hex}@example.com")
    other = client.get("/api/v1/catalog/export").content.decode("utf-8").lstrip("﻿")
    assert other.strip().splitlines() == [",".join(TEMPLATE_COLUMNS)]


def test_cashier_cannot_export_costs(client, db) -> None:
    email = f"export-cashier-{uuid4().hex}@example.com"
    signup = _login(client, email)
    membership = db.query(Membership).filter(
        Membership.user_id == UUID(signup["user_id"]),
        Membership.tenant_id == UUID(signup["tenant_id"])).one()
    membership.role = "cashier"
    db.commit()
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"})
    assert client.get("/api/v1/catalog/export").status_code == 403

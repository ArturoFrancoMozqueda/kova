import hashlib
import io
import zipfile
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from openpyxl import Workbook

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.catalog.models import Product
from app.imports import service as import_service
from app.orders.models import InventoryMovement

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _xlsx_bytes(rows: list[list[object]], *, extra_sheet: bool = False) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Productos"
    for row in rows:
        sheet.append(row)
    if extra_sheet:
        workbook.create_sheet("Otra hoja")
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def _xlsx_with_macro_part(content: bytes) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(content)) as source, zipfile.ZipFile(
        output, "w", compression=zipfile.ZIP_DEFLATED
    ) as target:
        for entry in source.infolist():
            target.writestr(entry, source.read(entry.filename))
        target.writestr("xl/vbaProject.bin", b"macro")
    return output.getvalue()


def _login(client, email: str) -> dict:
    signup = client.post(
        "/api/v1/auth/signup",
        json={
            "email": email,
            "password": "S3cur3pass!",
            "tenant_name": "Import Bakery",
            "accepted_terms": True,
        },
    )
    assert signup.status_code == 201, signup.text
    body = signup.json()
    assert client.post(
        "/api/v1/auth/verify", json={"token": body["dev_verification_token"]}
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"}
    ).status_code == 200
    return body


def test_catalog_import_dry_run_reports_row_errors_without_writes(client, db):
    signup = _login(client, f"import-dry-{uuid4().hex}@example.com")
    csv_body = (
        "nombre,sku,precio,costo,categoria,control_inventario,stock_inicial,umbral_stock\n"
        "Concha,CON-1,18.00,8.00,Pan dulce,sí,20,5\n"
        "Muffin,CON-1,no-es-numero,,Pan dulce,no,2,\n"
    )
    response = client.post(
        "/api/v1/catalog/import?dry_run=true",
        content=csv_body.encode(),
        headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["valid_rows"] == 1
    assert body["error_rows"] == 1
    assert "sku está repetido" in " ".join(body["rows"][1]["errors"])
    assert "precio debe ser" in " ".join(body["rows"][1]["errors"])
    assert "activa control_inventario" in " ".join(body["rows"][1]["errors"])
    assert (
        db.query(Product)
        .filter(Product.tenant_id == UUID(signup["tenant_id"]))
        .count()
        == 0
    )


def test_catalog_import_commit_is_transactional_idempotent_and_uses_stock_ledger(client, db):
    signup = _login(client, f"import-commit-{uuid4().hex}@example.com")
    csv_body = (
        "nombre,sku,precio,costo,categoria,control_inventario,stock_inicial,umbral_stock\n"
        "Concha,con-1,18.00,8.00,Pan dulce,sí,20,5\n"
        "Café,CFE-1,35.50,,Bebidas,no,,\n"
    )
    headers = {"Content-Type": "text/csv", "Idempotency-Key": "catalog-import-1"}
    first = client.post(
        "/api/v1/catalog/import?dry_run=false", content=csv_body.encode(), headers=headers
    )
    replay = client.post(
        "/api/v1/catalog/import?dry_run=false", content=csv_body.encode(), headers=headers
    )
    assert first.status_code == 201, first.text
    assert replay.status_code == 201
    assert replay.json() == first.json()
    result = first.json()
    assert result["created_products"] == 2
    assert result["created_categories"] == 2
    assert result["initial_stock_movements"] == 1

    tenant_id = UUID(signup["tenant_id"])
    products = db.query(Product).filter(Product.tenant_id == tenant_id).all()
    assert len(products) == 2
    concha = next(product for product in products if product.sku == "CON-1")
    assert concha.cost_price == Decimal("8.00")
    [movement] = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.tenant_id == tenant_id)
        .all()
    )
    assert movement.product_id == concha.id
    assert movement.quantity_delta == 20
    assert movement.stock_on_hand_after == 20
    [audit] = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == tenant_id, AuditLog.action == "catalog.import")
        .all()
    )
    assert audit.changes["created_products"] == 2


def test_catalog_import_rejects_cashier(client, db):
    email = f"import-cashier-{uuid4().hex}@example.com"
    signup = _login(client, email)
    membership = (
        db.query(Membership)
        .filter(
            Membership.user_id == UUID(signup["user_id"]),
            Membership.tenant_id == UUID(signup["tenant_id"]),
        )
        .one()
    )
    membership.role = "cashier"
    db.commit()
    client.post("/api/v1/auth/logout")
    client.post(
        "/api/v1/auth/login", json={"email": email, "password": "S3cur3pass!"}
    )
    response = client.post(
        "/api/v1/catalog/import?dry_run=true",
        content=b"nombre,precio\nConcha,18.00\n",
        headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 403


def test_catalog_import_template_has_cost_and_stock_columns(client):
    _login(client, f"import-template-{uuid4().hex}@example.com")
    response = client.get("/api/v1/catalog/import/template")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.content.startswith(b"\xef\xbb\xbf")
    assert "costo" in response.text
    assert "stock_inicial" in response.text


def test_catalog_import_accepts_utf8_bom_and_preserves_spanish_accents(client):
    _login(client, f"import-bom-{uuid4().hex}@example.com")
    csv_body = (
        "\ufeffnombre,sku,precio,categoria,control_inventario\n"
        "Café de olla,CAF-Ñ-1,38.00,Bebidas frías,sí\n"
    ).encode("utf-8")

    response = client.post(
        "/api/v1/catalog/import?dry_run=true",
        content=csv_body,
        headers={"Content-Type": "text/csv"},
    )

    assert response.status_code == 200, response.text
    [row] = response.json()["rows"]
    assert row["status"] == "valid"
    assert row["normalized"]["name"] == "Café de olla"
    assert row["normalized"]["sku"] == "CAF-Ñ-1"
    assert row["normalized"]["category_name"] == "Bebidas frías"
    assert row["normalized"]["track_inventory"] is True


def test_catalog_import_rolls_back_every_write_when_commit_fails_midway(
    client, db, monkeypatch
):
    signup = _login(client, f"import-atomic-{uuid4().hex}@example.com")
    tenant_id = UUID(signup["tenant_id"])
    user_id = UUID(signup["user_id"])
    csv_body = (
        "nombre,sku,precio,categoria\n"
        "Concha,ATOMIC-1,18.00,Pan dulce\n"
        "Café,ATOMIC-2,35.00,Bebidas\n"
    ).encode()
    original_create = import_service.catalog_repo.create_product
    calls = 0

    def fail_on_second_product(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated database failure")
        return original_create(*args, **kwargs)

    monkeypatch.setattr(import_service.catalog_repo, "create_product", fail_on_second_product)

    with pytest.raises(RuntimeError, match="simulated database failure"):
        import_service.commit_catalog_csv(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            content=csv_body,
            idempotency_key="catalog-import-atomic",
        )
    db.rollback()

    assert db.query(Product).filter(Product.tenant_id == tenant_id).count() == 0
    assert (
        db.query(InventoryMovement)
        .filter(InventoryMovement.tenant_id == tenant_id)
        .count()
        == 0
    )
    assert (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == tenant_id, AuditLog.action == "catalog.import")
        .count()
        == 0
    )


def test_catalog_import_reports_inactive_category_instead_of_reactivating_it(client):
    _login(client, f"import-inactive-{uuid4().hex}@example.com")
    created = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Temporada"},
        headers={"Idempotency-Key": "inactive-category-create"},
    )
    assert created.status_code == 201, created.text
    deleted = client.delete(
        f"/api/v1/catalog/categories/{created.json()['id']}",
        headers={"Idempotency-Key": "inactive-category-delete"},
    )
    assert deleted.status_code == 200, deleted.text

    response = client.post(
        "/api/v1/catalog/import?dry_run=true",
        content=b"nombre,precio,categoria\nRosca,40.00,temporada\n",
        headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["error_rows"] == 1
    assert "categoria existe pero está desactivada" in response.json()["rows"][0]["errors"]


def test_catalog_import_rejects_non_finite_money_and_duplicate_headers(client):
    _login(client, f"import-numeric-{uuid4().hex}@example.com")
    preview = client.post(
        "/api/v1/catalog/import?dry_run=true",
        content=b"nombre,precio\nConcha,NaN\n",
        headers={"Content-Type": "text/csv"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["error_rows"] == 1

    duplicate_headers = client.post(
        "/api/v1/catalog/import?dry_run=true",
        content=b"nombre,precio,precio\nConcha,18,19\n",
        headers={"Content-Type": "text/csv"},
    )
    assert duplicate_headers.status_code == 400
    assert "encabezados repetidos" in duplicate_headers.text


def test_xlsx_preview_and_idempotent_commit_use_the_existing_catalog_pipeline(client, db):
    signup = _login(client, f"import-xlsx-{uuid4().hex}@example.com")
    content = _xlsx_bytes([
        list(import_service.TEMPLATE_COLUMNS),
        ["Café de olla", "CAF-Ñ-XLSX", 38, 12.5, "Bebidas frías", "sí", 8, 2],
    ])
    media_headers = {"Content-Type": XLSX_MEDIA_TYPE}

    preview = client.post(
        "/api/v1/catalog/import?dry_run=true&format=xlsx",
        content=content,
        headers=media_headers,
    )
    assert preview.status_code == 200, preview.text
    [row] = preview.json()["rows"]
    assert row["normalized"] == {
        "name": "Café de olla",
        "sku": "CAF-Ñ-XLSX",
        "price_amount": "38.00",
        "cost_price": "12.50",
        "category_name": "Bebidas frías",
        "track_inventory": True,
        "initial_stock": 8,
        "low_stock_threshold": 2,
    }

    commit_headers = {
        **media_headers,
        "Idempotency-Key": "catalog-import-xlsx-idempotent",
    }
    first = client.post(
        "/api/v1/catalog/import?dry_run=false&format=xlsx",
        content=content,
        headers=commit_headers,
    )
    replay = client.post(
        "/api/v1/catalog/import?dry_run=false&format=xlsx",
        content=content,
        headers=commit_headers,
    )
    assert first.status_code == 201, first.text
    assert replay.status_code == 201
    assert replay.json() == first.json()

    tenant_id = UUID(signup["tenant_id"])
    [product] = db.query(Product).filter(Product.tenant_id == tenant_id).all()
    assert product.name == "Café de olla"
    [audit] = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == tenant_id, AuditLog.action == "catalog.import")
        .all()
    )
    assert audit.changes["file_format"] == "xlsx"


@pytest.mark.parametrize(
    ("content", "expected_error"),
    [
        (b"not-an-xlsx", "cifrado ni dañado"),
        (b"\xd0\xcf\x11\xe0encrypted-office", "cifrado ni dañado"),
    ],
)
def test_xlsx_rejects_corrupt_or_encrypted_containers(client, content, expected_error):
    _login(client, f"import-xlsx-invalid-{uuid4().hex}@example.com")
    response = client.post(
        "/api/v1/catalog/import?dry_run=true&format=xlsx",
        content=content,
        headers={"Content-Type": XLSX_MEDIA_TYPE},
    )
    assert response.status_code == 400
    assert expected_error in response.text


def test_xlsx_rejects_formulas_without_evaluating_them(client):
    _login(client, f"import-xlsx-formula-{uuid4().hex}@example.com")
    content = _xlsx_bytes([
        ["nombre", "precio"],
        ["Concha", "=9+9"],
    ])
    response = client.post(
        "/api/v1/catalog/import?dry_run=true&format=xlsx",
        content=content,
        headers={"Content-Type": XLSX_MEDIA_TYPE},
    )
    assert response.status_code == 400
    assert "contiene una fórmula" in response.text
    assert "B2" in response.text


def test_xlsx_rejects_macros_multiple_sheets_and_excess_columns(client):
    _login(client, f"import-xlsx-structure-{uuid4().hex}@example.com")
    valid = _xlsx_bytes([["nombre", "precio"], ["Concha", 18]])
    cases = [
        (_xlsx_with_macro_part(valid), "macros no están permitidos"),
        (
            _xlsx_bytes([["nombre", "precio"], ["Concha", 18]], extra_sheet=True),
            "exactamente una hoja",
        ),
        (
            _xlsx_bytes([
                [*import_service.TEMPLATE_COLUMNS, "columna_extra"],
                ["Concha", "C-1", 18, None, None, None, None, None, "extra"],
            ]),
            "máximo 8 columnas",
        ),
    ]
    for content, expected_error in cases:
        response = client.post(
            "/api/v1/catalog/import?dry_run=true&format=xlsx",
            content=content,
            headers={"Content-Type": XLSX_MEDIA_TYPE},
        )
        assert response.status_code == 400
        assert expected_error in response.text


def test_catalog_import_rejects_format_and_content_type_mismatch(client):
    _login(client, f"import-xlsx-media-{uuid4().hex}@example.com")
    xlsx_content = _xlsx_bytes([["nombre", "precio"], ["Concha", 18]])
    csv_content = b"nombre,precio\nConcha,18\n"

    cases = (
        ("xlsx", xlsx_content, "text/csv", "no coincide con el formato XLSX"),
        ("csv", csv_content, XLSX_MEDIA_TYPE, "no coincide con el formato CSV"),
        ("csv", xlsx_content, "text/csv", "contenido del archivo no coincide"),
        ("xlsx", csv_content, XLSX_MEDIA_TYPE, "No pudimos abrir el archivo Excel"),
    )
    for file_format, content, content_type, expected_error in cases:
        response = client.post(
            f"/api/v1/catalog/import?dry_run=true&format={file_format}",
            content=content,
            headers={"Content-Type": content_type},
        )

        assert response.status_code == 400
        assert expected_error in response.text


def test_catalog_import_hash_preserves_csv_identity_and_namespaces_xlsx():
    content = b"same exact bytes"

    csv_hash = import_service._catalog_import_request_hash(content, file_format="csv")
    xlsx_hash = import_service._catalog_import_request_hash(content, file_format="xlsx")

    assert csv_hash == hashlib.sha256(content).hexdigest()
    assert xlsx_hash == hashlib.sha256(b"xlsx\0" + content).hexdigest()
    assert xlsx_hash != csv_hash


def test_xlsx_enforces_row_cell_and_uncompressed_package_limits(client):
    _login(client, f"import-xlsx-limits-{uuid4().hex}@example.com")
    too_many_rows = _xlsx_bytes(
        [["nombre", "precio"]]
        + [[f"Producto {number}", 18] for number in range(import_service.MAX_IMPORT_ROWS + 1)]
    )
    long_cell = _xlsx_bytes([
        ["nombre", "precio"],
        ["x" * (import_service.MAX_XLSX_CELL_CHARACTERS + 1), 18],
    ])
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", b"<Types />")
        archive.writestr("xl/workbook.xml", b"<workbook />")
        archive.writestr(
            "xl/oversized.xml",
            b"0" * (import_service.MAX_XLSX_UNCOMPRESSED_BYTES + 1),
        )

    for content, expected_error in (
        (too_many_rows, "máximo 1000 productos"),
        (long_cell, "excede el límite de caracteres"),
        (bomb.getvalue(), "excede los límites permitidos"),
    ):
        response = client.post(
            "/api/v1/catalog/import?dry_run=true&format=xlsx",
            content=content,
            headers={"Content-Type": XLSX_MEDIA_TYPE},
        )
        assert response.status_code == 400
        assert expected_error in response.text

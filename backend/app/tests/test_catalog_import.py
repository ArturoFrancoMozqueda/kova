from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.audit.models import AuditLog
from app.auth.models import Membership
from app.catalog.models import Product
from app.imports import service as import_service
from app.orders.models import InventoryMovement


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

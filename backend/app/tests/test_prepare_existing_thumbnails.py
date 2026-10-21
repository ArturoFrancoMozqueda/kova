import argparse
import builtins
import json
import logging
import os
import sys
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import event, select, update

from app.catalog import image_router as images
from app.catalog.models import Product, ProductImageFile
from app.tenants.models import Tenant
from app.tests.test_product_image_persistence import (
    db as db,
)
from app.tests.test_product_image_persistence import (
    empty_thumbnail_cache as empty_thumbnail_cache,
)
from app.tests.test_product_image_persistence import (
    runtime_writer as runtime_writer,
)
from app.tests.test_product_image_persistence import (
    stored_image as stored_image,
)
from app.tests.test_product_image_persistence import (
    variants,
)
from scripts import prepare_product_thumbnails as maintenance

SHA = "a" * 40


def valid_env():
    return {"APP_ENV": "production", "GITHUB_ACTIONS": "true", "GITHUB_REF": "refs/heads/main",
            "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_SHA": SHA,
            "SUPABASE_DB_URL": "sealed-synthetic-connection"}


@pytest.mark.parametrize("key,value", [
    ("APP_ENV", "local"), ("GITHUB_ACTIONS", "false"), ("GITHUB_REF", "refs/heads/feature/test"),
    ("GITHUB_SHA", "b" * 40), ("GITHUB_EVENT_NAME", "push"), ("SUPABASE_DB_URL", ""),
])
def test_ci_guards_reject_before_app_import_or_database(key, value, monkeypatch, capsys):
    env = valid_env()
    env[key] = value
    original = builtins.__import__

    def guarded(name, *args, **kwargs):
        if name.startswith(("app", "sqlalchemy")):
            pytest.fail("Rejected invocation imported application/database")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded)
    assert maintenance.main(["--prepare-existing", "--sha", SHA], env) == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err == "Product thumbnail preparation failed\n"
    assert env["SUPABASE_DB_URL"] not in output.err or not env["SUPABASE_DB_URL"]


@pytest.mark.parametrize("limit", [0, 101, -1])
def test_limit_and_explicit_intent_fail_closed(limit):
    with pytest.raises(maintenance.PreparationError):
        maintenance.validate_execution(argparse.Namespace(
            prepare_existing=True, expected_sha=SHA, limit=limit,
        ), valid_env())
    with pytest.raises(maintenance.PreparationError):
        maintenance.validate_execution(argparse.Namespace(
            prepare_existing=False, expected_sha=SHA, limit=1,
        ), valid_env())


def test_real_runtime_role_prepares_legacy_cache_and_second_run_is_idempotent(
    db, stored_image, owner_engine, monkeypatch,
):
    db.execute(update(Product).where(Product.id == stored_image.product_id).values(
        image_url="/api/v1/catalog/products/synthetic/image?v=1",
    ))
    db.commit()
    old_version = stored_image.updated_at
    roles = []

    def observe(connection, _cursor, statement, _params, _context, _many):
        if statement.lstrip().upper().startswith("UPDATE PRODUCT_IMAGE_FILES"):
            roles.append(connection.exec_driver_sql("SELECT current_user").scalar_one())

    event.listen(owner_engine, "before_cursor_execute", observe)
    try:
        result = maintenance.prepare_existing(owner_engine, limit=1)
    finally:
        event.remove(owner_engine, "before_cursor_execute", observe)
    assert result == {"images_checked": 1, "variants_existing": 0,
                      "variants_prepared": 3, "variants_unneeded": 1}
    assert roles == ["kova_app"] * 3
    assert set(variants(db, stored_image.image_id)) == {"160", "320", "400"}
    assert db.execute(select(ProductImageFile.updated_at).where(
        ProductImageFile.id == stored_image.image_id,
    )).scalar_one() == old_version
    db.close()
    calls = []
    original = images._prepare_upload_variants

    def observe_widths(data, mime, widths=None):
        calls.append(widths)
        return original(data, mime, widths)

    monkeypatch.setattr(images, "_prepare_upload_variants", observe_widths)
    again = maintenance.prepare_existing(owner_engine, limit=1)
    assert again == {"images_checked": 1, "variants_existing": 3,
                     "variants_prepared": 0, "variants_unneeded": 1}
    assert calls == [{800}]


def test_discovery_excludes_inactive_and_unpublished_and_caps_identifiers(
    db, stored_image, owner_engine, monkeypatch,
):
    assert maintenance.prepare_existing(owner_engine, limit=1)["images_checked"] == 0
    db.execute(update(Product).where(Product.id == stored_image.product_id).values(
        image_url="/api/v1/catalog/products/synthetic/image?v=1", is_active=False,
    ))
    db.commit()
    assert maintenance.prepare_existing(owner_engine, limit=1)["images_checked"] == 0
    db.execute(update(Product).where(Product.id == stored_image.product_id).values(is_active=True))
    db.execute(update(Tenant).where(Tenant.id == db.get(Product, stored_image.product_id).tenant_id)
               .values(is_active=False))
    db.commit()
    assert maintenance.prepare_existing(owner_engine, limit=1)["images_checked"] == 0


def test_changed_source_during_preparation_fails_without_stale_write(
    db, stored_image, owner_engine, monkeypatch,
):
    db.execute(update(Product).where(Product.id == stored_image.product_id).values(image_url="/image?v=1"))
    db.commit()
    original = images._prepare_upload_variants

    def replace_source(data, mime, widths=None):
        db.execute(update(ProductImageFile).where(ProductImageFile.id == stored_image.image_id)
                   .values(bytes_data=stored_image.second))
        db.commit()
        return original(data, mime, widths)

    monkeypatch.setattr(images, "_prepare_upload_variants", replace_source)
    with pytest.raises(maintenance.PreparationError):
        maintenance.prepare_existing(owner_engine, limit=1)
    assert variants(db, stored_image.image_id) is None


def test_discovery_never_loads_more_than_one_hundred_originals(db, stored_image, owner_engine):
    from app.tests.test_catalog import PNG_BYTES

    tenant_id = db.get(Product, stored_image.product_id).tenant_id
    for index in range(101):
        product_id = uuid4()
        db.add(Product(id=product_id, tenant_id=tenant_id, name=f"Bounded photo {index}",
                       price_amount=1, image_url=f"/api/v1/catalog/products/{product_id}/image?v=1"))
        db.flush()
        db.add(ProductImageFile(tenant_id=tenant_id, product_id=product_id, bytes_data=PNG_BYTES,
                                content_type="image/png", byte_size=len(PNG_BYTES)))
    db.commit()
    originals = []

    def observe(_connection, _cursor, statement, _params, _context, _many):
        if "product_image_files.bytes_data" in statement.lower() and statement.startswith("SELECT"):
            originals.append(statement)

    event.listen(owner_engine, "before_cursor_execute", observe)
    try:
        result = maintenance.prepare_existing(owner_engine, limit=100)
    finally:
        event.remove(owner_engine, "before_cursor_execute", observe)
    assert result["images_checked"] == 100
    assert result["variants_prepared"] == 0  # Tiny originals require no derivative.
    assert len(originals) == 100


@pytest.fixture
def restore_main_process_state(monkeypatch):
    # main is normally a short-lived process. Protect the pytest process from
    # its intentional sealed-env installation and logging suppression.
    for name in ("DATABASE_URL", "APP_DATABASE_URL", "MIGRATION_DATABASE_URL", "APP_ENV"):
        monkeypatch.setenv(name, os.environ.get(name, ""))
    disabled = logging.root.manager.disable
    search_path = sys.path.copy()
    try:
        yield
    finally:
        logging.disable(disabled)
        sys.path[:] = search_path


@pytest.mark.parametrize("failed", [False, True])
def test_main_wires_sealed_tls_transport_and_disposes_without_leaking(
    monkeypatch, capsys, restore_main_process_state, failed,
):
    import sqlalchemy

    env = valid_env()
    env["SUPABASE_DB_URL"] = (
        "postgresql://migration:synthetic-maintenance-password@db.example.test:5432/synthetic"
    )
    engine = MagicMock()
    counters = {"images_checked": 2, "variants_existing": 1,
                "variants_prepared": 3, "variants_unneeded": 4}
    calls = []

    def create_engine(url, **options):
        # Real database_urls must have normalized the input before this first
        # initialization; no real driver/socket is opened by this test.
        assert url.drivername == "postgresql+psycopg"
        assert url.query["sslmode"] == "require"
        assert url.host == "db.example.test"
        assert url.password == "synthetic-maintenance-password"
        for name in ("DATABASE_URL", "APP_DATABASE_URL", "MIGRATION_DATABASE_URL"):
            assert os.environ[name] == url.render_as_string(hide_password=False)
        assert os.environ["APP_ENV"] == "production"
        assert options == {"pool_size": 1, "max_overflow": 0, "pool_timeout": 5,
                           "hide_parameters": True,
                           "connect_args": {"prepare_threshold": None, "connect_timeout": 15}}
        calls.append("engine")
        return engine

    def prepare(actual, *, limit):
        assert actual is engine
        assert limit == 7
        assert calls == ["engine"]
        calls.append("prepare")
        if failed:
            raise RuntimeError("synthetic-private-failure " + env["SUPABASE_DB_URL"])
        return counters

    monkeypatch.setattr(sqlalchemy, "create_engine", create_engine)
    monkeypatch.setattr(maintenance, "prepare_existing", prepare)
    status = maintenance.main(["--prepare-existing", "--sha", SHA, "--limit", "7"], env)
    engine.dispose.assert_called_once_with()
    assert calls == ["engine", "prepare"]
    output = capsys.readouterr()
    if failed:
        assert status == 1
        assert output.out == ""
        assert output.err == "Product thumbnail preparation failed\n"
    else:
        assert status == 0
        assert json.loads(output.out) == counters
        assert output.err == ""
    for private in ("synthetic-maintenance-password", "db.example.test", "synthetic-private-failure"):
        assert private not in output.out + output.err


def test_preflight_role_failure_is_a_fixed_code_without_raw_diagnostics(owner_engine):
    def reject_role(_connection, _cursor, statement, _params, _context, _many):
        if statement == "SET LOCAL ROLE kova_app":
            raise RuntimeError("synthetic-private-password SQL UUID")

    event.listen(owner_engine, "before_cursor_execute", reject_role)
    try:
        with pytest.raises(maintenance.PreparationError) as error:
            maintenance.prepare_existing(owner_engine, limit=1)
    finally:
        event.remove(owner_engine, "before_cursor_execute", reject_role)
    assert error.value.code == "runtime_role_unavailable"
    assert str(error.value) == ""


@pytest.mark.parametrize("code", ["runtime_role_unavailable", "cache_write_or_source_changed",
                                  "deadline_exceeded", "synthetic-private-password"])
def test_main_prints_only_whitelisted_failure_codes(
    monkeypatch, capsys, restore_main_process_state, code,
):
    import sqlalchemy

    env = valid_env()
    env["SUPABASE_DB_URL"] = "postgresql://synthetic:private@db.example.test/synthetic"
    engine = MagicMock()
    monkeypatch.setattr(sqlalchemy, "create_engine", lambda *_args, **_kwargs: engine)

    def fail(*_args, **_kwargs):
        raise maintenance.PreparationError(code)

    monkeypatch.setattr(maintenance, "prepare_existing", fail)
    assert maintenance.main(["--prepare-existing", "--sha", SHA], env) == 1
    output = capsys.readouterr()
    assert output.out == ""
    expected = "Product thumbnail preparation failed"
    if code in maintenance.FAILURE_CODES:
        expected += f": {code}"
    assert output.err == expected + "\n"
    engine.dispose.assert_called_once_with()

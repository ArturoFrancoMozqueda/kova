"""Explicit main-only CI maintenance: prepare at most 100 existing public photos.

Only derived cache columns are written, using the application's bounded decoder
and source-content CAS under SET LOCAL ROLE kova_app. No business rows, upload
versions, public URLs, roles or grants are changed. Output contains counters only.
"""

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from uuid import UUID

FAILURE_CODES = frozenset({
    "runtime_role_unavailable", "cache_write_or_source_changed", "deadline_exceeded",
})


class PreparationError(RuntimeError):
    def __init__(self, code=None):
        self.code = code if code in FAILURE_CODES else None
        super().__init__()


def validate_execution(args, env):
    if (not args.prepare_existing or env.get("APP_ENV") != "production"
            or env.get("GITHUB_ACTIONS") != "true"
            or env.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
            or env.get("GITHUB_REF") != "refs/heads/main"
            or not re.fullmatch(r"[0-9a-f]{40}", args.expected_sha or "")
            or args.expected_sha != env.get("GITHUB_SHA")
            or not 1 <= args.limit <= 100 or not env.get("SUPABASE_DB_URL")):
        raise PreparationError


def prepare_existing(engine, *, limit=100):
    if not 1 <= limit <= 100:
        raise PreparationError
    # Delayed imports: rejected invocation never initializes application config
    # or a connection. Importing app.main is deliberately unnecessary.
    from sqlalchemy import event, select, text
    from sqlalchemy.orm import Session, sessionmaker

    from app.catalog import image_router as images
    from app.catalog.models import Product, ProductImageFile
    from app.tenants.models import Tenant

    class RuntimeCacheSession(Session):
        pass

    @event.listens_for(RuntimeCacheSession, "after_begin")
    def enforce_runtime_role(_session, _transaction, connection):
        connection.execute(text("SET LOCAL ROLE kova_app"))

    writer = sessionmaker(bind=engine, class_=RuntimeCacheSession)
    # Fail before owner discovery if the existing role cannot actually be
    # assumed or its posture would bypass tenant isolation.
    try:
        with writer() as session:
            session.execute(text("SET LOCAL statement_timeout = '5s'"))
            role = session.execute(text(
                "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles "
                "WHERE rolname = current_user"
            )).one()
            if tuple(role) != ("kova_app", False, False):
                raise PreparationError("runtime_role_unavailable")
            session.rollback()
    except Exception:
        raise PreparationError("runtime_role_unavailable") from None
    base = (select(ProductImageFile.id)
            .join(Product, (Product.id == ProductImageFile.product_id)
                  & (Product.tenant_id == ProductImageFile.tenant_id))
            .join(Tenant, Tenant.id == Product.tenant_id)
            .where(Product.is_active.is_(True), Tenant.is_active.is_(True),
                   Product.image_url.is_not(None),
                   ProductImageFile.byte_size.between(1, 1024 * 1024),
                   ProductImageFile.content_type.in_(images.ALLOWED_CONTENT_TYPES)))
    counters = {"images_checked": 0, "variants_existing": 0,
                "variants_prepared": 0, "variants_unneeded": 0}
    deadline = time.monotonic() + 540
    with engine.connect() as connection:
        connection.execute(text("SET TRANSACTION READ ONLY"))
        connection.execute(text("SET LOCAL statement_timeout = '5s'"))
        identifiers = list(connection.execute(base.order_by(
            ProductImageFile.thumbnail_variants.is_not(None), ProductImageFile.id,
        ).limit(limit)).scalars())
    for identifier in identifiers:
        if time.monotonic() >= deadline:
            raise PreparationError("deadline_exceeded")
        image_id = UUID(str(identifier))
        with engine.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            connection.execute(text("SET LOCAL statement_timeout = '5s'"))
            row = connection.execute(base.with_only_columns(
                ProductImageFile.id, ProductImageFile.tenant_id, ProductImageFile.product_id,
                ProductImageFile.bytes_data, ProductImageFile.content_type,
                ProductImageFile.thumbnail_variants,
            ).where(ProductImageFile.id == image_id,
                    # Trust actual bytes, not only the size metadata.
                    images.func.octet_length(ProductImageFile.bytes_data) <= 1024 * 1024,
                    )).one_or_none()
        if row is None:
            continue
        image_id, tenant_id, product_id, source, source_mime, stored = row
        image_id, tenant_id, product_id = (
            UUID(str(value)) for value in (image_id, tenant_id, product_id)
        )
        counters["images_checked"] += 1
        digest = hashlib.sha256(source).digest()
        stored = stored if isinstance(stored, dict) else {}
        missing = [width for width in sorted(images.ALLOWED_RESIZE_WIDTHS)
                   if images._persisted_thumbnail(
                       stored.get(str(width)), digest, source_mime, width) is None]
        counters["variants_existing"] += len(images.ALLOWED_RESIZE_WIDTHS) - len(missing)
        if not missing:
            del source, row, stored
            continue
        prepared = images._prepare_upload_variants(source, source_mime, set(missing)) or {}
        for width in missing:
            entry = prepared.get(str(width))
            if entry is None:
                counters["variants_unneeded"] += 1
                continue
            if not images._persist_thumbnail(image_id, tenant_id, product_id, width, entry,
                                             session_factory=writer):
                raise PreparationError("cache_write_or_source_changed")
            counters["variants_prepared"] += 1
        # Release the only original before loading the next image; the codec
        # retains only the existing 4MiB LRU of derived thumbnails.
        del source, row, prepared, stored
    return counters


def main(argv=None, env=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-existing", action="store_true")
    parser.add_argument("--expected-sha", "--sha", dest="expected_sha", required=True)
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args(argv)
    env = os.environ if env is None else env
    engine = None
    try:
        validate_execution(args, env)
        logging.disable(logging.CRITICAL)
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from sqlalchemy import create_engine

        from scripts.provision_native_runtime import database_urls

        _, url = database_urls(env["SUPABASE_DB_URL"], "unused-maintenance-role")
        # These sealed values never enter output. No app.main import and no
        # .env fallback can change the approved transport for lazy app.db.
        sealed = url.render_as_string(hide_password=False)
        for name in ("DATABASE_URL", "APP_DATABASE_URL", "MIGRATION_DATABASE_URL"):
            os.environ[name] = sealed
        os.environ["APP_ENV"] = "production"
        engine = create_engine(url, pool_size=1, max_overflow=0, pool_timeout=5,
                               hide_parameters=True, connect_args={
                                   "prepare_threshold": None, "connect_timeout": 15,
                               })
        result = prepare_existing(engine, limit=args.limit)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        code = error.code if isinstance(error, PreparationError) else None
        if code in FAILURE_CODES:
            print(f"Product thumbnail preparation failed: {code}", file=sys.stderr)
        else:
            print("Product thumbnail preparation failed", file=sys.stderr)
        return 1
    finally:
        if engine is not None:
            try:
                engine.dispose()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())

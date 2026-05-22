"""One-off backfill: generate SKUs for products that have a NULL or empty
SKU (Sprint 5 BUG-014). Uses the same `<3-letter category prefix>-<id>`
format as the live create path.

Idempotent: rows that already have a non-empty SKU are skipped.

Usage:
    uv run python backend/scripts/backfill_skus.py            # apply
    uv run python backend/scripts/backfill_skus.py --dry-run  # preview
"""

from __future__ import annotations

import argparse
import os
import re
import secrets
import sys
from collections import defaultdict

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

_SKU_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _category_prefix(name: str | None) -> str:
    if not name:
        return "PRD"
    letters = re.sub(r"[^A-Z]", "", name.upper())
    return letters[:3] if len(letters) >= 3 else "PRD"


def _generate_sku(prefix: str, taken: set[str]) -> str:
    for _ in range(8):
        suffix = "".join(secrets.choice(_SKU_ALPHABET) for _ in range(5))
        candidate = f"{prefix}-{suffix}"
        if candidate not in taken:
            taken.add(candidate)
            return candidate
    raise RuntimeError("Could not generate a unique SKU after 8 attempts")


def _build_engine() -> Engine:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is required. Aborting.")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return create_engine(url, future=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()
    engine = _build_engine()
    per_tenant = defaultdict(int)
    with engine.begin() as conn:
        existing = {
            row.sku
            for row in conn.execute(
                text("SELECT sku FROM products WHERE sku IS NOT NULL AND sku <> ''")
            )
        }
        rows = conn.execute(
            text(
                """
                SELECT p.id, p.tenant_id, c.name AS category_name
                FROM products p
                LEFT JOIN categories c ON c.id = p.category_id
                WHERE p.sku IS NULL OR btrim(p.sku) = ''
                """,
            ),
        ).all()
        for row in rows:
            sku = _generate_sku(_category_prefix(row.category_name), existing)
            per_tenant[str(row.tenant_id)] += 1
            if args.dry_run:
                continue
            conn.execute(
                text("UPDATE products SET sku = :sku WHERE id = :id"),
                {"sku": sku, "id": row.id},
            )

    verb = "Would assign" if args.dry_run else "Assigned"
    for tenant_id, count in per_tenant.items():
        print(f"{verb} {count} SKU(s) for tenant {tenant_id}")
    if not per_tenant:
        print("No products needed a SKU. Nothing to do.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

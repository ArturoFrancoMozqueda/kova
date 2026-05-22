"""One-off maintenance: find products whose computed stock_on_hand is below
zero (Sprint 5 BUG-002) and write a compensating adjustment movement so
the next snapshot reads zero.

We do NOT mutate historical movements — instead we insert a single
`stock_adjustment` movement per affected product with the inverse delta
and a clear reason. Tenants get a per-tenant summary at the end.

Idempotent: re-running after the first clamp is a no-op (no products
will be below zero anymore).

Usage:
    uv run python backend/scripts/clamp_negative_stock.py            # apply
    uv run python backend/scripts/clamp_negative_stock.py --dry-run  # preview
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


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
    per_tenant: dict[str, list[tuple[str, int]]] = defaultdict(list)

    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                    p.id AS product_id,
                    p.tenant_id,
                    p.name,
                    COALESCE(SUM(m.quantity_delta), 0)::int AS on_hand
                FROM products p
                LEFT JOIN inventory_movements m ON m.product_id = p.id
                WHERE p.track_inventory IS TRUE
                GROUP BY p.id, p.tenant_id, p.name
                HAVING COALESCE(SUM(m.quantity_delta), 0) < 0
                """,
            ),
        ).all()

        for row in rows:
            delta = -int(row.on_hand)  # restore to zero
            per_tenant[str(row.tenant_id)].append((row.name, int(row.on_hand)))
            if args.dry_run:
                continue
            conn.execute(
                text(
                    """
                    INSERT INTO inventory_movements
                        (id, tenant_id, product_id, order_id, movement_type,
                         quantity_delta, reason, created_by_user_id,
                         stock_on_hand_after, created_at)
                    VALUES
                        (gen_random_uuid(), :tenant_id, :product_id, NULL,
                         'stock_adjustment', :delta,
                         'Sprint 5 BUG-002: clamp to 0', NULL, 0, NOW())
                    """,
                ),
                {
                    "tenant_id": row.tenant_id,
                    "product_id": row.product_id,
                    "delta": delta,
                },
            )

    verb = "Would clamp" if args.dry_run else "Clamped"
    for tenant_id, products in per_tenant.items():
        print(f"\nTenant {tenant_id}: {verb} {len(products)} product(s)")
        for name, on_hand in products:
            print(f"  - {name}: {on_hand} -> 0")
    if not per_tenant:
        print("No products had negative stock. Nothing to do.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

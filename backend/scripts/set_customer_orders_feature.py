#!/usr/bin/env python3
"""Enable or disable Pedidos for exactly one tenant.

Uses the migration/owner connection because tenant RLS is forced. The command
never prints connection details and requires the current tenant name as a
confirmation guard before writing.

Examples:
    python scripts/set_customer_orders_feature.py \
        --tenant-id 00000000-0000-0000-0000-000000000000 \
        --enable --confirm-tenant-name "Piloto Centro"

    python scripts/set_customer_orders_feature.py \
        --tenant-id 00000000-0000-0000-0000-000000000000 --disable \
        --confirm-tenant-name "Piloto Centro"
"""

import argparse
import sys
from pathlib import Path
from uuid import UUID

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import settings, sqlalchemy_database_url
from app.tenants.feature_flags import CUSTOMER_ORDERS
from app.tenants.models import Tenant


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Cambia el feature flag customer_orders para un solo tenant."
    )
    parser.add_argument("--tenant-id", type=UUID, required=True)
    state = parser.add_mutually_exclusive_group(required=True)
    state.add_argument("--enable", action="store_true")
    state.add_argument("--disable", action="store_true")
    parser.add_argument(
        "--confirm-tenant-name",
        help="Nombre exacto actual del tenant; obligatorio para escribir.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Muestra el cambio propuesto sin modificar la base.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    engine = create_engine(
        sqlalchemy_database_url(settings.effective_migration_database_url),
        pool_pre_ping=True,
    )
    try:
        with Session(engine) as db:
            tenant = db.scalar(select(Tenant).where(Tenant.id == args.tenant_id))
            if tenant is None:
                print("tenant_not_found", file=sys.stderr)
                return 2

            current = tenant.feature_overrides.get(CUSTOMER_ORDERS) is True
            target = bool(args.enable)
            print(
                f"tenant_id={tenant.id} tenant_name={tenant.name!r} "
                f"customer_orders_current={str(current).lower()} "
                f"customer_orders_target={str(target).lower()}"
            )

            if args.dry_run:
                print("dry_run=true changed=false")
                return 0
            if args.confirm_tenant_name != tenant.name:
                print(
                    "confirmation_failed: pasa --confirm-tenant-name con el nombre exacto mostrado",
                    file=sys.stderr,
                )
                return 3
            if current == target:
                print("changed=false reason=already_in_target_state")
                return 0

            tenant.feature_overrides = {
                **tenant.feature_overrides,
                CUSTOMER_ORDERS: target,
            }
            db.commit()
            print("changed=true")
            return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

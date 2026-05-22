"""Idempotent maintenance script to add Spanish accents to common category
names that were persisted before the i18n accent pass (Sprint 5).

Run once per database. Safe to re-run: it only updates rows whose name
exactly matches the unaccented form.

Usage:
    uv run python backend/scripts/fix_category_accents.py            # apply
    uv run python backend/scripts/fix_category_accents.py --dry-run  # preview
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Iterable

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

# Known cafe-preset categories whose names lost their accents in the
# original preset. Extend deliberately — do NOT machine-translate.
RENAMES: dict[str, str] = {
    "Cafe caliente": "Café caliente",
    "Bebidas frias": "Bebidas frías",
    "Cafeteria": "Cafetería",
}


def _build_engine() -> Engine:
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is required. Aborting.")
    # SQLAlchemy expects postgresql:// (not postgres://).
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return create_engine(url, future=True)


def _affected_rows(engine: Engine, *, dry_run: bool) -> Iterable[tuple[str, int]]:
    with engine.begin() as conn:
        for old, new in RENAMES.items():
            count = conn.execute(
                text("SELECT COUNT(*) FROM categories WHERE name = :old"),
                {"old": old},
            ).scalar_one()
            if not count:
                continue
            yield (f"{old} -> {new}", int(count))
            if not dry_run:
                conn.execute(
                    text("UPDATE categories SET name = :new WHERE name = :old"),
                    {"old": old, "new": new},
                )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()
    engine = _build_engine()
    any_changes = False
    for label, count in _affected_rows(engine, dry_run=args.dry_run):
        any_changes = True
        verb = "Would update" if args.dry_run else "Updated"
        print(f"{verb} {count} row(s): {label}")
    if not any_changes:
        print("No rows matched the known accent fixes. Nothing to do.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

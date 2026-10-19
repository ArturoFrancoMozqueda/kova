"""Run deterministic tasks for an explicit server cohort, using the RLS runtime role."""

import argparse
import sys
import time
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.automations.worker import process_tenant  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import assert_rls_active  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    assert_rls_active()
    tenants = [UUID(value) for value in settings.automation_tenant_ids.split(",") if value]
    while True:
        for tenant_id in tenants:
            process_tenant(tenant_id, limit=50)
        if args.once:
            return
        time.sleep(60)


if __name__ == "__main__":
    main()

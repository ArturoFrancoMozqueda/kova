"""Usage: uv run python scripts/run_assistant_worker.py [--once]. No privileged DB."""

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.assistant.access import assert_private_policies  # noqa: E402
from app.assistant.worker import process_once
from app.config import settings
from app.db import assert_rls_active

parser = argparse.ArgumentParser()
parser.add_argument("--once", action="store_true")
args = parser.parse_args()
if settings.app_env == "production":
    if not settings.app_database_url:
        raise SystemExit("Worker requires an explicit least-privilege APP_DATABASE_URL")
    if settings.secret_key == "change-me-in-production-use-a-long-random-string":
        raise SystemExit("Worker requires a production signing key")
assert_rls_active()
assert_private_policies()
while True:
    try:
        process_once()
    except Exception:
        # Private queries, files and provider responses never enter logs.
        logging.getLogger(__name__).error("Assistant worker iteration failed")
        if args.once:
            raise SystemExit(1) from None
    if args.once:
        break
    time.sleep(5)

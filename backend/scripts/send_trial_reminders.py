#!/usr/bin/env python3
"""Send trial-ending reminder emails. Intended for daily cron.

Usage (locally):
    uv run python scripts/send_trial_reminders.py

In production, the GitHub Actions scheduler runs this entrypoint. Successful
acceptance is recorded in ``tenants.trial_reminder_sent_at``; failures leave
the job red and eligible for retry before trial expiry.
"""
import logging
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings, sqlalchemy_database_url
from app.email.trial_reminders import TrialReminderBatchError, send_due_trial_reminders


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    engine = create_engine(sqlalchemy_database_url(settings.database_url))
    try:
        with Session(engine) as db:
            count = send_due_trial_reminders(db)
    except TrialReminderBatchError as exc:
        logging.error("trial_reminder.batch_failed sent=%d failed=%d", exc.sent, exc.failed)
        return 1
    finally:
        engine.dispose()
    print(f"trial_reminder.batch sent={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

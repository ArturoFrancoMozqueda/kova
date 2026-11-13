"""One interactive deadline, including queue time; no replay of uncertain calls."""

import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime

from fastapi import HTTPException

LIMIT_SECONDS = 10
TIMEOUT_MESSAGE = "La consulta alcanzó su tiempo límite. Acota la pregunta."
_deadline = ContextVar("assistant_deadline", default=None)


def expired(job):
    return (datetime.now(UTC) - job.created_at).total_seconds() >= LIMIT_SECONDS


def expire_pending(db, tenant, user):
    """Close overdue turns under the caller's tenant/user ACL, without replaying I/O.

    Keep uncertain reservations and leases: an external call can still be in flight.
    The worker's normal completion guard prevents a late answer from being saved.
    """
    from datetime import timedelta

    from app.assistant import repository as repo

    cutoff = datetime.now(UTC) - timedelta(seconds=LIMIT_SECONDS)
    # Admission holds the quota advisory lock; do not wait on a job whose worker
    # may already hold its row lock while acquiring that same quota lock.
    rows = repo.records(db, tenant, user, "run").filter(
        repo.AssistantRecord.status.in_(["queued", "running"]),
        repo.AssistantRecord.created_at <= cutoff,
    ).with_for_update(skip_locked=True).all()
    for row in rows:
        row.status = "failed"
        repo.update(row, error=TIMEOUT_MESSAGE, error_code=503)


def remaining():
    end = _deadline.get()
    seconds = LIMIT_SECONDS if end is None else end - time.monotonic()
    if seconds <= 0:
        raise HTTPException(503, TIMEOUT_MESSAGE)
    return seconds


@contextmanager
def scope(job):
    age = max(0, (datetime.now(UTC) - job.created_at).total_seconds())
    token = _deadline.set(time.monotonic() + LIMIT_SECONDS - age)
    try:
        remaining()
        yield
    finally:
        _deadline.reset(token)

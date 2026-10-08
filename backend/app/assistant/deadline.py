"""One interactive deadline, including queue time; no replay of uncertain calls."""

import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime

from fastapi import HTTPException

LIMIT_SECONDS = 10
_deadline = ContextVar("assistant_deadline", default=None)


def expired(job):
    return (datetime.now(UTC) - job.created_at).total_seconds() >= LIMIT_SECONDS


def remaining():
    end = _deadline.get()
    seconds = LIMIT_SECONDS if end is None else end - time.monotonic()
    if seconds <= 0:
        raise HTTPException(503, "La consulta alcanzó su tiempo límite. Acota la pregunta.")
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

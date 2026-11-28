from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.telemetry.export import summarize_task_experience
from app.telemetry.schemas import TelemetryEventCreate


def properties(**changes):
    return {
        "task": "customer_order", "attempt_id": str(uuid4()), "offline": False,
        "outcome": "completed", "active_ms": 1200, "elapsed_ms": 5000, **changes,
    }


@pytest.mark.parametrize("changes", [
    {"active_ms": True}, {"elapsed_ms": -1}, {"active_ms": 6000},
    {"elapsed_ms": 86_400_001}, {"attempt_id": "order-123"},
    {"task": "customer@example.com"}, {"offline": "yes"}, {"free_text": "private"},
])
def test_task_events_reject_unbounded_or_identifying_properties(changes):
    with pytest.raises(ValidationError):
        TelemetryEventCreate(event_name="task_finished", client_event_id="event", properties=properties(**changes))


def test_summary_pairs_offline_delivery_without_inventing_arrival_time_durations():
    data = properties()
    def event(name, body, tenant="tenant-a", user="user-a"):
        return SimpleNamespace(event_name=name, properties=body, tenant_id=tenant, user_id=user)
    start = {key: data[key] for key in ("task", "attempt_id", "offline")}
    result = event("task_finished", data)
    rows = summarize_task_experience([result, result, event("task_started", start)])
    row = next(row for row in rows if row["task"] == "customer_order")
    assert row == {
        "task": "customer_order", "started": 1, "finished": 1, "completed": 1,
        "failed": 0, "cancelled": 0, "queued": 0, "unresolved": 0,
        "unpaired_results": 0, "conflicting_results": 0, "completion_rate": 1.0,
        "completed_active_median_ms": 1200, "completed_elapsed_median_ms": 5000,
    }
    # Same opaque attempt in another authenticated context cannot complete it.
    rows = summarize_task_experience([event("task_started", start), event("task_finished", data, user="user-b")])
    row = next(row for row in rows if row["task"] == "customer_order")
    assert row["completed"] == 0
    assert row["unresolved"] == row["unpaired_results"] == 1


def test_summary_never_counts_queued_or_conflicting_results_as_completion():
    data = properties(outcome="queued", offline=True)
    start = {key: data[key] for key in ("task", "attempt_id", "offline")}
    def event(name, body):
        return SimpleNamespace(event_name=name, properties=body, tenant_id="a", user_id="b")
    events = [event("task_started", start), event("task_finished", data)]
    row = next(row for row in summarize_task_experience(events) if row["task"] == "customer_order")
    assert row["queued"] == 1 and row["completed"] == 0
    assert row["completed_active_median_ms"] is None
    events.append(event("task_finished", {**data, "outcome": "completed"}))
    row = next(row for row in summarize_task_experience(events) if row["task"] == "customer_order")
    assert row["completed"] == row["queued"] == 0
    assert row["conflicting_results"] == row["unresolved"] == 1


@pytest.mark.parametrize("task", ["production_batch", "shift_close"])
def test_production_and_shift_close_are_measured_tasks(task):
    event = TelemetryEventCreate(
        event_name="task_finished", client_event_id="event", properties=properties(task=task)
    )
    assert event.properties["task"] == task
    assert task in {row["task"] for row in summarize_task_experience([])}

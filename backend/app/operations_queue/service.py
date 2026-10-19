"""Four SELECT projections, at most 21 rows each; no domain mutations or side effects."""

from datetime import UTC, datetime

from sqlalchemy import func

from app.appointments.models import Appointment, AppointmentReminder
from app.branches.scope import active_branch_id
from app.crm.engagement_models import FollowupTask
from app.crm.models import Opportunity
from app.customers.models import Customer
from app.operations_queue.schemas import (
    OperationsQueueItem,
    OperationsQueueResponse,
    OperationsQueueSection,
)
from app.service_cases.models import ServiceCase

SECTION_LIMIT = 20


def now():
    return datetime.now(UTC)


def _projection(db, tenant_id, model, state_column):
    """Project only safe queue fields; do not hydrate notes, contacts or monetary amounts."""
    branch_id = active_branch_id(db, tenant_id)
    return (
        db.query(
            model.id.label("source_id"),
            model.title.label("title"),
            Customer.name.label("customer_name"),
            state_column.label("state"),
            model.version.label("version"),
            model.due_at.label("due_at"),
        )
        .join(
            Customer,
            (Customer.tenant_id == model.tenant_id) & (Customer.id == model.customer_id),
        )
        .filter(model.tenant_id == tenant_id, model.branch_id == branch_id)
        .order_by(model.due_at.asc().nulls_last(), model.id)
    )


def _section(source, route, rows, generated_at):
    items = []
    for row in rows[:SECTION_LIMIT]:
        due_at = row.due_at.astimezone(UTC) if row.due_at is not None else None
        items.append(
            OperationsQueueItem(
                source_id=row.source_id,
                title=row.title,
                customer_name=row.customer_name,
                state=row.state,
                version=row.version,
                due_at=due_at,
                overdue=due_at is not None and due_at < generated_at,
                route_key=route,
            )
        )
    return OperationsQueueSection(source=source, items=items, has_more=len(rows) > SECTION_LIMIT)


def read_queue(db, *, tenant_id):
    generated_at = now()
    cases = (
        _projection(db, tenant_id, ServiceCase, ServiceCase.status)
        .filter(ServiceCase.status.in_(("open", "in_progress", "reopened")))
        .limit(SECTION_LIMIT + 1)
        .all()
    )
    opportunities = (
        _projection(db, tenant_id, Opportunity, Opportunity.stage)
        .filter(
            Opportunity.stage.in_(("new", "contacted", "proposal")),
            Opportunity.next_action.is_not(None),
            func.btrim(Opportunity.next_action, " \t\r\n") != "",
        )
        .limit(SECTION_LIMIT + 1)
        .all()
    )
    followups = (
        _projection(db, tenant_id, FollowupTask, FollowupTask.status)
        .filter(FollowupTask.status == "pending")
        .limit(SECTION_LIMIT + 1)
        .all()
    )
    branch_id = active_branch_id(db, tenant_id)
    reminders = (
        db.query(
            AppointmentReminder.id.label("source_id"),
            Appointment.title.label("title"),
            Customer.name.label("customer_name"),
            AppointmentReminder.status.label("state"),
            AppointmentReminder.version.label("version"),
            AppointmentReminder.due_at.label("due_at"),
        )
        .join(
            Appointment,
            (Appointment.id == AppointmentReminder.appointment_id)
            & (Appointment.tenant_id == AppointmentReminder.tenant_id)
            & (Appointment.branch_id == AppointmentReminder.branch_id),
        )
        .join(
            Customer,
            (Customer.id == Appointment.customer_id)
            & (Customer.tenant_id == Appointment.tenant_id),
        )
        .filter(
            AppointmentReminder.tenant_id == tenant_id,
            AppointmentReminder.branch_id == branch_id,
            Appointment.tenant_id == tenant_id,
            Appointment.branch_id == branch_id,
            AppointmentReminder.status == "pending",
            Appointment.status == "scheduled",
            Appointment.version == AppointmentReminder.appointment_version,
            AppointmentReminder.due_at <= generated_at,
        )
        .order_by(AppointmentReminder.due_at, AppointmentReminder.id)
        .limit(SECTION_LIMIT + 1)
        .all()
    )
    return OperationsQueueResponse(
        generated_at=generated_at,
        sections=[
            _section("service_cases", "service_cases", cases, generated_at),
            _section("opportunities", "crm", opportunities, generated_at),
            _section("followups", "followups", followups, generated_at),
            _section("appointment_reminders", "appointments", reminders, generated_at),
        ],
    )

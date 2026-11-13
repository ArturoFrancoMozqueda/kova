"""Bounded, read-only customer context from the current branch's existing records."""

from sqlalchemy import Uuid, cast, literal, union_all

from app.appointments.models import Appointment
from app.bookings.models import PublicBooking, TableReservation
from app.branches.scope import active_branch_id
from app.crm.engagement_models import FollowupTask
from app.crm.models import Opportunity
from app.customer_orders.models import CustomerOrder
from app.customers.schemas import CustomerActivity, CustomerActivitySection
from app.service_cases.models import ServiceCase

ACTIVITY_LIMIT = 10


def read_activity(db, *, tenant_id, customer_id, include_customer_orders=True):
    branch_id = active_branch_id(db, tenant_id)
    sections = []
    sources = [
        ("appointments", Appointment, Appointment.status, Appointment.starts_at),
        ("opportunities", Opportunity, Opportunity.stage, Opportunity.due_at),
        ("followups", FollowupTask, FollowupTask.status, FollowupTask.due_at),
        ("service_cases", ServiceCase, ServiceCase.status, ServiceCase.due_at),
    ]
    if include_customer_orders:
        sources.append(
            ("customer_orders", CustomerOrder, CustomerOrder.status, CustomerOrder.promised_at)
        )
    for source, model, state, due in sources:
        base = db.query(
            model.id,
            (model.folio if source == "customer_orders" else model.title).label("title"),
            state.label("state"),
            model.created_at,
            due.label("due_at"),
            cast(literal(None), Uuid).label("booking_id"),
            cast(literal(None), Uuid).label("table_id"),
        ).filter(
            model.tenant_id == tenant_id,
            model.branch_id == branch_id,
            model.customer_id == customer_id,
        )
        if source == "appointments":
            public = db.query(
                PublicBooking.id,
                PublicBooking.title,
                PublicBooking.status.label("state"),
                PublicBooking.created_at,
                PublicBooking.starts_at.label("due_at"),
                PublicBooking.id.label("booking_id"),
                cast(literal(None), Uuid).label("table_id"),
            ).filter(
                PublicBooking.tenant_id == tenant_id,
                PublicBooking.branch_id == branch_id,
                PublicBooking.customer_id == customer_id,
                PublicBooking.appointment_id.is_(None),
            )
            tables = db.query(
                TableReservation.id,
                literal("Reserva de mesa").label("title"),
                TableReservation.status.label("state"),
                TableReservation.created_at,
                TableReservation.starts_at.label("due_at"),
                cast(literal(None), Uuid).label("booking_id"),
                TableReservation.id.label("table_id"),
            ).filter(
                TableReservation.tenant_id == tenant_id,
                TableReservation.branch_id == branch_id,
                TableReservation.customer_id == customer_id,
            )
            combined = union_all(base.statement, public.statement, tables.statement).subquery()
            rows = (
                db.query(combined)
                .order_by(combined.c.created_at.desc(), combined.c.id)
                .limit(ACTIVITY_LIMIT + 1)
                .all()
            )
        else:
            rows = base.order_by(model.created_at.desc(), model.id).limit(ACTIVITY_LIMIT + 1).all()
        sections.append(
            CustomerActivitySection(
                source=source,
                items=[dict(row._mapping) for row in rows[:ACTIVITY_LIMIT]],
                has_more=len(rows) > ACTIVITY_LIMIT,
            )
        )
    return CustomerActivity(branch_id=branch_id, sections=sections)

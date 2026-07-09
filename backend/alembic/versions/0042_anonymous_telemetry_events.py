"""anonymous (pre-auth) telemetry events

Adds a dedicated table for pre-authentication funnel events (landing page-view,
CTA click, signup start) keyed only by the client-generated ``client_id``.

It is intentionally separate from ``telemetry_events`` and carries no
``tenant_id``/``user_id`` and no FK into the tenanted schema, so an
unauthenticated visitor can write to it without touching (or weakening) the
tenant-scoped, RLS-protected authenticated telemetry path.

No RLS is enabled here on purpose: the rows are non-tenant, PII-free anonymous
counts, and access is bounded at the API layer (allowlisted event types,
per-IP rate limit, bounded payload, no tenant/user fields accepted).

Revision ID: 0042_anonymous_telemetry_events
Revises: 0041_single_open_shift
Create Date: 2026-07-09 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0042_anonymous_telemetry_events"
down_revision: str | None = "0041_single_open_shift"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "anonymous_telemetry_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_name", sa.String(length=120), nullable=False),
        sa.Column("client_id", sa.String(length=80), nullable=False),
        sa.Column("client_event_id", sa.String(length=80), nullable=False),
        sa.Column("properties", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_event_id", name="uq_anon_telemetry_client_event"),
    )
    op.create_index(
        "ix_anon_telemetry_events_event_name",
        "anonymous_telemetry_events",
        ["event_name"],
    )
    op.create_index(
        "ix_anon_telemetry_events_client_id",
        "anonymous_telemetry_events",
        ["client_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_anon_telemetry_events_client_id", table_name="anonymous_telemetry_events"
    )
    op.drop_index(
        "ix_anon_telemetry_events_event_name", table_name="anonymous_telemetry_events"
    )
    op.drop_table("anonymous_telemetry_events")

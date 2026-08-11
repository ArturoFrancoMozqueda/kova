"""quarantine contaminated funnel data and make signup_completed server-only

Two changes, both in service of one goal: the funnel table should only contain
rows we can defend.

1. ``is_trusted`` / ``ingest_source`` columns. Every pre-existing row is marked
   untrusted, because the window they cover does not reconcile: ~48
   ``signup_completed`` events against 2 accounts actually created
   (``docs/audits/DIAGNOSTICO-CRECIMIENTO-2026-08-09.md``). Read paths filter on
   ``is_trusted`` so the contaminated window is excluded from analysis without
   destroying the evidence.

2. ``signup_completed`` is removed from the RLS insert policy. The runtime
   ``kova_app`` role can therefore no longer write it at all, including through
   the public anonymous endpoint. The signup route writes it on the privileged
   engine (RLS bypass) from inside the transaction that created the account.

Revision ID: 0055_trusted_anonymous_telemetry
Revises: 0054_products_rls_empty_context
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0055_trusted_anonymous_telemetry"
down_revision: str | None = "0054_products_rls_empty_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Client-writable events only. ``signup_completed`` is deliberately absent.
_CLIENT_EVENTS = (
    "landing_viewed",
    "landing_section_viewed",
    "landing_story_step_viewed",
    "landing_cta_clicked",
    "signup_started",
    "signup_validation_failed",
    "experiment_exposed",
    "product_demo_viewed",
    "product_demo_step_changed",
    "pricing_viewed",
    "whatsapp_clicked",
    "login_clicked",
    "faq_opened",
)
_PREVIOUS_EVENTS = _CLIENT_EVENTS + ("signup_completed",)
_FORBIDDEN_PROPERTIES = (
    "tenant_id",
    "user_id",
    "email",
    "name",
    "phone",
    "password",
    "amount",
    "total_amount",
    "amount_minor_units",
    "query",
    "query_string",
    "full_url",
)


def _replace_policy(events: tuple[str, ...]) -> None:
    allowed = ",\n                ".join(f"'{event}'" for event in events)
    forbidden = ",\n                    ".join(
        f"'{property_name}'" for property_name in _FORBIDDEN_PROPERTIES
    )
    op.execute(
        "DROP POLICY IF EXISTS anonymous_telemetry_events_insert "
        "ON anonymous_telemetry_events"
    )
    op.execute(
        f"""
        CREATE POLICY anonymous_telemetry_events_insert
        ON anonymous_telemetry_events
        FOR INSERT
        WITH CHECK (
            event_name IN (
                {allowed}
            )
            AND NOT (
                properties::jsonb ?| ARRAY[
                    {forbidden}
                ]
            )
        )
        """
    )


def upgrade() -> None:
    op.add_column(
        "anonymous_telemetry_events",
        sa.Column(
            "is_trusted", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
    )
    op.add_column(
        "anonymous_telemetry_events",
        sa.Column(
            "ingest_source",
            sa.String(length=16),
            nullable=False,
            server_default="client",
        ),
    )
    op.create_index(
        "ix_anonymous_telemetry_events_is_trusted",
        "anonymous_telemetry_events",
        ["is_trusted"],
    )
    # Everything written before origin verification existed is unverifiable.
    op.execute("UPDATE anonymous_telemetry_events SET is_trusted = false")
    _replace_policy(_CLIENT_EVENTS)


def downgrade() -> None:
    _replace_policy(_PREVIOUS_EVENTS)
    op.drop_index(
        "ix_anonymous_telemetry_events_is_trusted",
        table_name="anonymous_telemetry_events",
    )
    op.drop_column("anonymous_telemetry_events", "ingest_source")
    op.drop_column("anonymous_telemetry_events", "is_trusted")

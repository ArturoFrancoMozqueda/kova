"""allow focused landing conversion telemetry

Revision ID: 0053_landing_conversion_events
Revises: 0052_landing_story_telemetry_rls
Create Date: 2026-07-29
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0053_landing_conversion_events"
down_revision: str | None = "0052_landing_story_telemetry_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_BASE_EVENTS = (
    "landing_viewed",
    "landing_section_viewed",
    "landing_story_step_viewed",
    "landing_cta_clicked",
    "signup_started",
    "signup_completed",
    "signup_validation_failed",
    "experiment_exposed",
)
_CONVERSION_EVENTS = (
    "product_demo_viewed",
    "product_demo_step_changed",
    "pricing_viewed",
    "whatsapp_clicked",
    "login_clicked",
    "faq_opened",
)
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
    _replace_policy(_BASE_EVENTS + _CONVERSION_EVENTS)


def downgrade() -> None:
    _replace_policy(_BASE_EVENTS)

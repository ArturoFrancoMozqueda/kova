"""allow anonymous landing story step telemetry

Revision ID: 0052_landing_story_telemetry_rls
Revises: 0051_expand_cro_telemetry_rls
Create Date: 2026-07-27
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0052_landing_story_telemetry_rls"
down_revision: str | None = "0051_expand_cro_telemetry_rls"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_FORBIDDEN_PROPERTIES = """
    'tenant_id',
    'user_id',
    'email',
    'name',
    'phone',
    'password',
    'amount',
    'total_amount',
    'amount_minor_units',
    'query',
    'query_string',
    'full_url'
"""


def _replace_policy(*, include_story_event: bool) -> None:
    story_event = "\n                'landing_story_step_viewed'," if include_story_event else ""
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
                'landing_viewed',
                'landing_section_viewed',{story_event}
                'landing_cta_clicked',
                'signup_started',
                'signup_completed',
                'signup_validation_failed',
                'experiment_exposed'
            )
            AND NOT (
                properties::jsonb ?| ARRAY[
                    {_FORBIDDEN_PROPERTIES}
                ]
            )
        )
        """
    )


def upgrade() -> None:
    _replace_policy(include_story_event=True)


def downgrade() -> None:
    _replace_policy(include_story_event=False)

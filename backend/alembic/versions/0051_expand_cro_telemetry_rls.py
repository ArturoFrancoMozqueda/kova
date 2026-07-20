"""expand anonymous telemetry allowlist for CRO measurement

Revision ID: 0051_expand_cro_telemetry_rls
Revises: 0050_account_deletions
Create Date: 2026-07-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0051_expand_cro_telemetry_rls"
down_revision: str | None = "0050_account_deletions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS anonymous_telemetry_events_insert "
        "ON anonymous_telemetry_events"
    )
    op.execute(
        """
        CREATE POLICY anonymous_telemetry_events_insert
        ON anonymous_telemetry_events
        FOR INSERT
        WITH CHECK (
            event_name IN (
                'landing_viewed',
                'landing_section_viewed',
                'landing_cta_clicked',
                'signup_started',
                'signup_completed',
                'signup_validation_failed',
                'experiment_exposed'
            )
            AND NOT (
                properties::jsonb ?| ARRAY[
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
                ]
            )
        )
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS anonymous_telemetry_events_insert "
        "ON anonymous_telemetry_events"
    )
    op.execute(
        """
        CREATE POLICY anonymous_telemetry_events_insert
        ON anonymous_telemetry_events
        FOR INSERT
        WITH CHECK (
            event_name IN (
                'landing_viewed',
                'landing_cta_clicked',
                'signup_started'
            )
            AND NOT (
                properties::jsonb ?| ARRAY[
                    'tenant_id',
                    'user_id',
                    'email',
                    'name',
                    'phone',
                    'password'
                ]
            )
        )
        """
    )

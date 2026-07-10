"""allow anonymous telemetry inserts under RLS

Revision ID: 0043_anon_telemetry_rls
Revises: 0042_anonymous_telemetry_events
Create Date: 2026-07-10 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0043_anon_telemetry_rls"
down_revision: str | None = "0042_anonymous_telemetry_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE anonymous_telemetry_events ENABLE ROW LEVEL SECURITY")
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


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS anonymous_telemetry_events_insert "
        "ON anonymous_telemetry_events"
    )
    op.execute("ALTER TABLE anonymous_telemetry_events DISABLE ROW LEVEL SECURITY")

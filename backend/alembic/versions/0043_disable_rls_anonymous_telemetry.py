"""disable RLS on anonymous telemetry events

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
    # This table is intentionally non-tenant and PII-free. Some production
    # databases may still have legacy DDL automation that enables RLS on new
    # tables, which turns this unauthenticated endpoint into a denied insert.
    op.execute("ALTER TABLE anonymous_telemetry_events NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE anonymous_telemetry_events DISABLE ROW LEVEL SECURITY")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                GRANT SELECT, INSERT, UPDATE, DELETE
                ON anonymous_telemetry_events TO kova_app;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
                REVOKE SELECT, INSERT, UPDATE, DELETE
                ON anonymous_telemetry_events FROM kova_app;
            END IF;
        END $$;
        """
    )

"""Separate interactive and ingestion capacity using quota metadata only."""

from alembic import op

revision = "0076_assistant_workload_slots"
down_revision = "0075_assistant"
branch_labels = None
depends_on = None


def upgrade():
    # Existing workers keep their original lane during a rolling deployment.
    op.execute("""ALTER TABLE assistant_control.slots ADD COLUMN workload text
        NOT NULL DEFAULT 'chat' CHECK (workload IN ('chat', 'ingest'))""")


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM assistant_control.slots WHERE workload='ingest') THEN
            RAISE EXCEPTION 'stop ingestion and drain leases before downgrade';
        END IF;
    END $$""")
    op.execute("ALTER TABLE assistant_control.slots DROP COLUMN workload")

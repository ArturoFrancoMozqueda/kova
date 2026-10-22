"""Business event ledger and opt-in, branch-bound internal automation tasks."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0080_business_automations"
down_revision = "0079_lot_trigger_search_path"
branch_labels = None
depends_on = None


def _identity():
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("branch_id", postgresql.UUID(as_uuid=True), nullable=False),
    ]


def upgrade():
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "automation_rules",
        *_identity(),
        sa.Column("template_key", sa.String(40), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("authorized_by_user_id", uuid, nullable=False),
        sa.Column("enabled_since", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "template_key", name="uq_automation_rule_key"
        ),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_automation_rule_owner"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.CheckConstraint("version >= 1", name="ck_automation_rule_version"),
        sa.CheckConstraint(
            "template_key IN ('order_ready', 'order_fulfilled', 'restock_review')",
            name="ck_automation_rule_template",
        ),
    )
    op.create_table(
        "business_events",
        *_identity(),
        sa.Column("event_type", sa.String(60), nullable=False),
        sa.Column("entity_id", uuid, nullable=False),
        sa.Column("entity_version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint(
            "tenant_id",
            "branch_id",
            "event_type",
            "entity_id",
            "entity_version",
            name="uq_business_event_identity",
        ),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_business_event_owner"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.CheckConstraint("entity_version >= 1", name="ck_business_event_version"),
        sa.CheckConstraint(
            "event_type IN ('customer_order.ready', 'customer_order.fulfilled', "
            "'customer_order.cancelled', 'inventory.restock_review')",
            name="ck_business_event_type",
        ),
    )
    op.create_table(
        "automation_runs",
        *_identity(),
        sa.Column("event_id", uuid, nullable=False),
        sa.Column("rule_id", uuid, nullable=False),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("template_key", sa.String(40), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("entity_id", uuid, nullable=False),
        sa.Column("entity_type", sa.String(24), nullable=False),
        sa.Column("entity_version", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("event_id", "rule_id", name="uq_automation_run_effect"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "event_id"],
            ["business_events.tenant_id", "business_events.branch_id", "business_events.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "rule_id"],
            ["automation_rules.tenant_id", "automation_rules.branch_id", "automation_rules.id"],
        ),
        sa.CheckConstraint("version >= 1 AND rule_version >= 1", name="ck_automation_run_version"),
        sa.CheckConstraint(
            "status IN ('pending', 'completed', 'dismissed', 'suppressed')",
            name="ck_automation_run_status",
        ),
    )
    for table in ("automation_rules", "business_events", "automation_runs"):
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.create_index(f"ix_{table}_branch_id", table, ["branch_id"])
        op.execute(f"""
            ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
            ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
            CREATE POLICY tenant_isolation ON {table} FOR ALL
              USING (tenant_id::text = current_setting('app.tenant_id', true))
              WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
            REVOKE ALL ON {table} FROM PUBLIC;
            DO $$ DECLARE r text; BEGIN
              FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
                  EXECUTE format('REVOKE ALL ON {table} FROM %I', r);
                END IF;
              END LOOP;
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
                GRANT SELECT, INSERT ON {table} TO kova_app;
              END IF;
            END $$;
        """)
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT UPDATE (processed_at) ON business_events TO kova_app;
            GRANT UPDATE (enabled, version, authorized_by_user_id, enabled_since, updated_at)
              ON automation_rules TO kova_app;
            GRANT UPDATE (status, version, resolved_at) ON automation_runs TO kova_app;
        END IF;
    END $$;""")
    op.create_index("ix_business_events_processed_at", "business_events", ["processed_at"])
    op.create_index("ix_automation_runs_event_id", "automation_runs", ["event_id"])
    op.create_index("ix_automation_runs_rule_id", "automation_runs", ["rule_id"])
    op.create_index(
        "ix_business_events_pending",
        "business_events",
        ["tenant_id", "branch_id", "created_at"],
        postgresql_where=sa.text("processed_at IS NULL"),
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM automation_rules) OR EXISTS (SELECT 1 FROM business_events)
           OR EXISTS (SELECT 1 FROM automation_runs) THEN
            RAISE EXCEPTION 'Preserve automation history before downgrade';
        END IF;
    END $$""")
    op.drop_table("automation_runs")
    op.drop_table("business_events")
    op.drop_table("automation_rules")

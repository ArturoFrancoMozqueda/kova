"""Private customer service cases with immutable author-attributed history."""

import sqlalchemy as sa

from alembic import op

revision = "0090_service_cases"
down_revision = "0089_internal_loyalty"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "service_cases",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("sale_order_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("customer_order_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("title", sa.String(length=160), nullable=False, primary_key=False),
        sa.Column("status", sa.String(length=16), nullable=False, primary_key=False),
        sa.Column("assigned_user_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True, primary_key=False),
        sa.Column("version", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True, primary_key=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.CheckConstraint(
            "(status IN ('resolved','cancelled')) = (resolved_at IS NOT NULL)",
            name="ck_service_case_resolution",
        ),
        sa.CheckConstraint(
            "status IN ('open','in_progress','resolved','reopened','cancelled')",
            name="ck_service_case_status",
        ),
        sa.CheckConstraint("version >= 1", name="ck_service_case_version"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "sale_order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "created_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "customer_order_id"],
            ["customer_orders.tenant_id", "customer_orders.branch_id", "customer_orders.id"],
        ),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_service_case_owner"),
    )
    op.create_index("ix_service_cases_tenant_id", "service_cases", ["tenant_id"])
    op.create_index("ix_service_cases_branch_id", "service_cases", ["branch_id"])
    op.create_index("ix_service_cases_customer_id", "service_cases", ["customer_id"])
    op.create_table(
        "service_case_events",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("case_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("case_version", sa.Integer(), nullable=False, primary_key=False),
        sa.Column("kind", sa.String(length=16), nullable=False, primary_key=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.Column("status", sa.String(length=16), nullable=False, primary_key=False),
        sa.Column("assigned_user_id", sa.Uuid(), nullable=True, primary_key=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True, primary_key=False),
        sa.Column("note", sa.String(length=2000), nullable=True, primary_key=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, primary_key=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False, primary_key=False),
        sa.CheckConstraint(
            "kind IN ('created','updated','note_added')", name="ck_service_case_event_kind"
        ),
        sa.CheckConstraint(
            "(kind = 'updated' AND note IS NULL) OR (kind != 'updated' AND note IS NOT NULL)",
            name="ck_service_case_event_note",
        ),
        sa.CheckConstraint(
            "status IN ('open','in_progress','resolved','reopened','cancelled')",
            name="ck_service_case_event_status",
        ),
        sa.CheckConstraint("case_version >= 1", name="ck_service_case_event_version"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "actor_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "case_id"],
            ["service_cases.tenant_id", "service_cases.branch_id", "service_cases.id"],
        ),
        sa.UniqueConstraint("case_id", "case_version", name="uq_service_case_event_version"),
    )
    op.create_index("ix_service_case_events_tenant_id", "service_case_events", ["tenant_id"])
    op.create_index("ix_service_case_events_branch_id", "service_case_events", ["branch_id"])
    op.create_index("ix_service_case_events_case_id", "service_case_events", ["case_id"])
    for table in ("service_cases", "service_case_events"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} FOR ALL "
            "USING (tenant_id::text = current_setting('app.tenant_id', true)) "
            "WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))"
        )
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON {table} FROM anon; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON {table} FROM authenticated; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN REVOKE ALL ON {table} FROM service_role; END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN GRANT SELECT, INSERT ON {table} TO kova_app; END IF;
        END $$;""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kova_app') THEN
            GRANT UPDATE(status,assigned_user_id,due_at,version,updated_at,resolved_at) ON service_cases TO kova_app;
        END IF;
    END $$;""")
    op.create_index(
        "ix_service_cases_queue", "service_cases", ["tenant_id", "branch_id", "status", "due_at"]
    )
    op.create_index(
        "ix_service_case_history",
        "service_case_events",
        ["tenant_id", "branch_id", "case_id", "case_version"],
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM service_cases) OR EXISTS (SELECT 1 FROM service_case_events)
        THEN RAISE EXCEPTION 'Cannot discard service cases or customer service history'; END IF;
    END $$;""")
    op.drop_table("service_case_events")
    op.drop_table("service_cases")

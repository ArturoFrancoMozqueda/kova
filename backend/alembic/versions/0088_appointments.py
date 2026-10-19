"""Internal resource scheduling and immutable appointment history."""

import sqlalchemy as sa

from alembic import op

revision = "0088_appointments"
down_revision = "0087_quote_opportunity_link"
branch_labels = None
depends_on = None
TABLES = ("appointment_resources", "appointments", "appointment_history", "appointment_reminders")


def _identity():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
    ]


def _time(name, nullable=False):
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _appointment_fk():
    return sa.ForeignKeyConstraint(
        ["tenant_id", "branch_id", "appointment_id"],
        ["appointments.tenant_id", "appointments.branch_id", "appointments.id"],
    )


def upgrade():
    op.create_table(
        TABLES[0],
        *_identity(),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("timezone", sa.String(48), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        _time("created_at"),
        _time("updated_at"),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_appointment_resource_owner"),
        sa.UniqueConstraint("tenant_id", "branch_id", "name", name="uq_appointment_resource_name"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.CheckConstraint("version>=1", name="ck_appointment_resource_version"),
        sa.CheckConstraint(
            "timezone IN ('America/Mexico_City','America/Cancun','America/Tijuana','America/Hermosillo','America/Mazatlan','America/Monterrey')",
            name="ck_appointment_resource_timezone",
        ),
    )
    op.create_table(
        TABLES[1],
        *_identity(),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        _time("starts_at"),
        _time("ends_at"),
        sa.Column("note", sa.String(1000)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        _time("created_at"),
        _time("updated_at"),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_appointment_owner"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "resource_id"],
            [
                "appointment_resources.tenant_id",
                "appointment_resources.branch_id",
                "appointment_resources.id",
            ],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "created_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.CheckConstraint(
            "version>=1 AND ends_at>starts_at AND ends_at<=starts_at+interval '24 hours'",
            name="ck_appointment_interval",
        ),
        sa.CheckConstraint(
            "status IN ('scheduled','cancelled','completed','no_show')",
            name="ck_appointment_status",
        ),
    )
    op.create_table(
        TABLES[2],
        *_identity(),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("appointment_version", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        _time("starts_at"),
        _time("ends_at"),
        sa.Column("note", sa.String(1000)),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        _time("created_at"),
        sa.UniqueConstraint(
            "appointment_id", "appointment_version", name="uq_appointment_history_version"
        ),
        _appointment_fk(),
        sa.ForeignKeyConstraint(
            ["tenant_id", "actor_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.CheckConstraint("appointment_version>=1", name="ck_appointment_history_version"),
    )
    op.create_table(
        TABLES[3],
        *_identity(),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("appointment_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        _time("due_at"),
        sa.Column("version", sa.Integer(), nullable=False),
        _time("created_at"),
        _time("resolved_at", nullable=True),
        sa.UniqueConstraint(
            "appointment_id", "appointment_version", name="uq_appointment_reminder_version"
        ),
        _appointment_fk(),
        sa.CheckConstraint(
            "appointment_version>=1 AND version>=1", name="ck_appointment_reminder_version"
        ),
        sa.CheckConstraint(
            "status IN ('pending','completed','dismissed','suppressed')",
            name="ck_appointment_reminder_status",
        ),
    )
    for table in TABLES:
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.create_index(f"ix_{table}_branch_id", table, ["branch_id"])
        op.execute(f"""ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
          ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
          CREATE POLICY tenant_isolation ON {table} FOR ALL
          USING(tenant_id::text=current_setting('app.tenant_id',true))
          WITH CHECK(tenant_id::text=current_setting('app.tenant_id',true));
          REVOKE ALL ON {table} FROM PUBLIC;
          DO $$ DECLARE r text; BEGIN
            FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
              IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON {table} FROM %I',r); END IF;
            END LOOP;
            IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT,INSERT ON {table} TO kova_app; END IF;
          END $$;""")
    for table, columns in (
        ("appointment_resources", "name,is_active,version,updated_at"),
        ("appointments", "starts_at,ends_at,note,status,version,updated_at"),
        ("appointment_reminders", "status,version,resolved_at"),
    ):
        op.execute(
            f"""DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT UPDATE({columns}) ON {table} TO kova_app; END IF; END $$;"""
        )
    op.create_index("ix_appointments_resource_id", "appointments", ["resource_id"])
    op.create_index("ix_appointments_customer_id", "appointments", ["customer_id"])
    op.create_index("ix_appointments_starts_at", "appointments", ["starts_at"])
    op.create_index(
        "ix_appointment_history_appointment_id", "appointment_history", ["appointment_id"]
    )
    op.create_index(
        "ix_appointment_reminders_appointment_id", "appointment_reminders", ["appointment_id"]
    )
    op.create_index("ix_appointment_reminders_due_at", "appointment_reminders", ["due_at"])
    op.create_index(
        "ix_appointments_resource_interval",
        "appointments",
        ["tenant_id", "branch_id", "resource_id", "status", "starts_at", "ends_at"],
    )


def downgrade():
    op.execute(
        "DO $$ BEGIN IF "
        + " OR ".join(f"EXISTS(SELECT 1 FROM {table})" for table in TABLES)
        + " THEN RAISE EXCEPTION 'Preserve internal agenda history before downgrade'; END IF; END $$;"
    )
    for table in reversed(TABLES):
        op.drop_table(table)

"""Branch-bound cash drawer connector and short-lived, at-most-once commands."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0078_drawer_bridge"
down_revision = "e9f2d5d835e6"
branch_labels = None
depends_on = None


def upgrade():
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "drawer_devices",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("tenant_id", uuid, nullable=False),
        sa.Column("branch_id", uuid, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("pin", sa.Integer(), nullable=False),
        sa.Column("auto_open", sa.Boolean(), nullable=False),
        sa.Column("pairing_hash", sa.String(64)),
        sa.Column("pairing_expires_at", sa.DateTime(timezone=True)),
        sa.Column("key_hash", sa.String(64)),
        sa.Column("key_expires_at", sa.DateTime(timezone=True)),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", name="uq_drawer_device_branch"),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_drawer_device_owner"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.CheckConstraint("pin IN (0, 1)", name="ck_drawer_device_pin"),
    )
    op.create_table(
        "drawer_commands",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("tenant_id", uuid, nullable=False),
        sa.Column("branch_id", uuid, nullable=False),
        sa.Column("device_id", uuid, nullable=False),
        sa.Column("request_key", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("order_id", uuid),
        sa.Column("requested_by_user_id", uuid, nullable=False),
        sa.Column("reason", sa.String(200), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "device_id"],
            ["drawer_devices.tenant_id", "drawer_devices.branch_id", "drawer_devices.id"],
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "order_id"],
            ["orders.tenant_id", "orders.branch_id", "orders.id"],
        ),
        sa.UniqueConstraint(
            "tenant_id", "branch_id", "request_key", name="uq_drawer_command_request"
        ),
        sa.CheckConstraint("kind IN ('sale', 'manual', 'test')", name="ck_drawer_command_kind"),
        sa.CheckConstraint(
            "status IN ('pending', 'dispatched', 'sent', 'failed', 'expired')",
            name="ck_drawer_command_status",
        ),
    )
    for table in ("drawer_devices", "drawer_commands"):
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
                GRANT SELECT, INSERT, UPDATE ON {table} TO kova_app;
              END IF;
            END $$;
        """)
    op.create_index("ix_drawer_commands_device_id", "drawer_commands", ["device_id"])
    op.create_index(
        "ix_drawer_commands_pending",
        "drawer_commands",
        ["device_id", "created_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade():
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM drawer_devices) THEN
            RAISE EXCEPTION 'Revoke connectors and preserve drawer history before downgrade';
        END IF;
    END $$""")
    op.drop_table("drawer_commands")
    op.drop_table("drawer_devices")

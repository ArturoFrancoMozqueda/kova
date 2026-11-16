"""Reservation template outbox; platform and branch delivery default to OFF."""

import sqlalchemy as sa

from alembic import op

revision = "0107_reservation_notices"
down_revision = "0106_whatsapp_coexistence"
branch_labels = None
depends_on = None
TABLE = "messaging_reservation_notices"
SOURCES = {
    "appointment_id": "appointments",
    "booking_id": "public_bookings",
    "reservation_id": "table_reservations",
}


def upgrade():
    op.create_table(
        TABLE,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        *(sa.Column(column, sa.Uuid()) for column in SOURCES),
        sa.Column("policy_version", sa.Integer()),
        sa.Column("message_id", sa.Uuid()),
        sa.UniqueConstraint("message_id", name="uq_reservation_notice_message"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "message_id"],
            [
                "messaging_messages.tenant_id",
                "messaging_messages.branch_id",
                "messaging_messages.id",
            ],
        ),
        sa.Column("source_revision", sa.String(64), nullable=False),
        sa.Column("snapshot_hash", sa.String(64), nullable=False),
        sa.Column("recipient_hash", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        *(
            sa.ForeignKeyConstraint(
                ["tenant_id", "branch_id", column],
                [f"{table}.tenant_id", f"{table}.branch_id", f"{table}.id"],
            )
            for column, table in SOURCES.items()
        ),
        *(
            sa.UniqueConstraint(
                column, "source_revision", "kind", name=f"uq_notice_{column}_revision"
            )
            for column in SOURCES
        ),
        sa.CheckConstraint(
            "num_nonnulls(appointment_id,booking_id,reservation_id) = 1",
            name="ck_reservation_notice_source",
        ),
        sa.CheckConstraint(
            "kind IN ('confirmation','reminder')", name="ck_reservation_notice_kind"
        ),
        sa.CheckConstraint(
            "state IN ('prepared','suppressed')", name="ck_reservation_notice_state"
        ),
    )
    for column in SOURCES:
        op.create_index(
            f"uq_notice_{column}_active",
            TABLE,
            [column, "kind"],
            unique=True,
            postgresql_where=sa.text("state = 'prepared'"),
        )
    op.create_index(
        "ix_reservation_notice_upcoming",
        TABLE,
        ["tenant_id", "branch_id", "state", "starts_at", "id"],
    )
    op.create_index(
        "ix_reservation_notice_due",
        TABLE,
        ["tenant_id", "branch_id", "policy_version", "due_at", "id"],
        postgresql_where=sa.text("state = 'prepared' AND policy_version IS NOT NULL"),
    )
    op.create_table(
        "messaging_reservation_policies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("branch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("binding_id", sa.Uuid()),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "binding_id"],
            [
                "messaging_channel_bindings.tenant_id",
                "messaging_channel_bindings.branch_id",
                "messaging_channel_bindings.id",
            ],
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("authorized_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("daily_limit", sa.Integer(), nullable=False),
        sa.Column("enabled_since", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "authorized_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.CheckConstraint(
            "version >= 1 AND daily_limit BETWEEN 1 AND 25", name="ck_reservation_policy"
        ),
    )
    op.execute("ALTER TABLE messaging_reservation_policies ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE messaging_reservation_policies FORCE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY tenant_isolation ON messaging_reservation_policies FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute("REVOKE ALL ON messaging_reservation_policies FROM PUBLIC")
    for role in ("anon", "authenticated", "service_role"):
        op.execute(f"""DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN
                REVOKE ALL ON messaging_reservation_policies FROM {role};
            END IF;
        END $$;""")
    op.drop_constraint("ck_messaging_conversation_state", "messaging_conversations")
    op.drop_constraint("ck_messaging_conversation_origin", "messaging_conversations")
    op.create_check_constraint(
        "ck_messaging_conversation_state",
        "messaging_conversations",
        "status IN ('open','closed') AND origin IN ('manual','whatsapp','business') AND version >= 1",
    )
    op.create_check_constraint(
        "ck_messaging_conversation_origin",
        "messaging_conversations",
        "(origin IN ('whatsapp','business')) = (binding_id IS NOT NULL AND external_party IS NOT NULL)",
    )
    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(f"""CREATE POLICY tenant_isolation ON {TABLE} FOR ALL
        USING (tenant_id::text = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true))""")
    op.execute(f"REVOKE ALL ON {TABLE} FROM PUBLIC")
    op.execute(f"""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON {TABLE} FROM anon; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON {TABLE} FROM authenticated; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN REVOKE ALL ON {TABLE} FROM service_role; END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT SELECT, INSERT ON {TABLE} TO kova_app;
            GRANT UPDATE(state,message_id) ON {TABLE} TO kova_app;
            GRANT SELECT, INSERT ON messaging_reservation_policies TO kova_app;
            GRANT UPDATE(enabled,binding_id,authorized_by_user_id,version,daily_limit,enabled_since,updated_at)
                ON messaging_reservation_policies TO kova_app;
        END IF;
    END $$;""")


def downgrade():
    op.execute(f"""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM {TABLE}) OR EXISTS (SELECT 1 FROM messaging_reservation_policies)
            OR EXISTS (SELECT 1 FROM messaging_conversations WHERE origin='business') THEN
            RAISE EXCEPTION 'Retain reservation notice history before downgrade';
        END IF;
    END $$;""")
    op.drop_table(TABLE)
    op.drop_table("messaging_reservation_policies")
    op.drop_constraint("ck_messaging_conversation_state", "messaging_conversations")
    op.drop_constraint("ck_messaging_conversation_origin", "messaging_conversations")
    op.create_check_constraint(
        "ck_messaging_conversation_state",
        "messaging_conversations",
        "status IN ('open','closed') AND origin IN ('manual','whatsapp') AND version >= 1",
    )
    op.create_check_constraint(
        "ck_messaging_conversation_origin",
        "messaging_conversations",
        "(origin='whatsapp') = (binding_id IS NOT NULL AND external_party IS NOT NULL)",
    )

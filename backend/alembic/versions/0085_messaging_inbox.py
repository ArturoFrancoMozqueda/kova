"""Private inbox and crash-safe outbox; no live channel is provisioned."""

import sqlalchemy as sa

from alembic import op

revision = "0085_messaging_inbox"
down_revision = "0084_customer_quotes"
branch_labels = None
depends_on = None
TABLES = (
    "messaging_channel_bindings",
    "messaging_conversations",
    "messaging_messages",
    "messaging_channel_events",
)


def identity():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
    ]


def fk_binding():
    return sa.ForeignKeyConstraint(
        ["tenant_id", "branch_id", "binding_id"],
        [
            "messaging_channel_bindings.tenant_id",
            "messaging_channel_bindings.branch_id",
            "messaging_channel_bindings.id",
        ],
    )


def upgrade():
    op.create_unique_constraint(
        "uq_automation_run_owner", "automation_runs", ["tenant_id", "branch_id", "id"]
    )
    op.create_table(
        TABLES[0],
        *identity(),
        sa.Column("waba_id", sa.String(32), nullable=False),
        sa.Column("phone_number_id", sa.String(32), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("phone_number_id", name="uq_messaging_binding_phone"),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_messaging_binding_owner"),
        sa.UniqueConstraint("tenant_id", "branch_id", name="uq_messaging_binding_branch"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
    )
    op.create_table(
        TABLES[1],
        *identity(),
        sa.Column("customer_id", sa.Uuid()),
        sa.Column("binding_id", sa.Uuid()),
        sa.Column("external_party", sa.String(256)),
        sa.Column("subject", sa.String(160), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("automation_paused", sa.Boolean(), nullable=False),
        sa.Column("assigned_user_id", sa.Uuid()),
        sa.Column("last_inbound_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_messaging_conversation_owner"),
        sa.UniqueConstraint("binding_id", "external_party", name="uq_messaging_conversation_party"),
        sa.ForeignKeyConstraint(["tenant_id", "branch_id"], ["branches.tenant_id", "branches.id"]),
        sa.ForeignKeyConstraint(
            ["tenant_id", "customer_id"], ["customers.tenant_id", "customers.id"]
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "assigned_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        fk_binding(),
        sa.CheckConstraint(
            "status IN ('open','closed') AND origin IN ('manual','whatsapp') AND version >= 1",
            name="ck_messaging_conversation_state",
        ),
        sa.CheckConstraint(
            "(origin='whatsapp') = (binding_id IS NOT NULL AND external_party IS NOT NULL)",
            name="ck_messaging_conversation_origin",
        ),
    )
    op.create_table(
        TABLES[2],
        *identity(),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("binding_id", sa.Uuid()),
        sa.Column("provider_message_id", sa.String(510)),
        sa.Column("source_run_id", sa.Uuid()),
        sa.UniqueConstraint("source_run_id", name="uq_messaging_source_run"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "source_run_id"],
            ["automation_runs.tenant_id", "automation_runs.branch_id", "automation_runs.id"],
        ),
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("body", sa.String(4096)),
        sa.Column("message_type", sa.String(40), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("purpose", sa.String(24)),
        sa.Column("requested_by_user_id", sa.Uuid()),
        sa.Column("contact_fingerprint", sa.String(64)),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "branch_id", "id", name="uq_messaging_message_owner"),
        sa.UniqueConstraint(
            "binding_id", "provider_message_id", name="uq_messaging_provider_message"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "branch_id", "conversation_id"],
            [
                "messaging_conversations.tenant_id",
                "messaging_conversations.branch_id",
                "messaging_conversations.id",
            ],
        ),
        fk_binding(),
        sa.ForeignKeyConstraint(
            ["tenant_id", "requested_by_user_id"], ["memberships.tenant_id", "memberships.user_id"]
        ),
        sa.CheckConstraint(
            "direction IN ('inbound','outbound') AND version >= 1",
            name="ck_messaging_message_direction",
        ),
        sa.CheckConstraint(
            "purpose IS NULL OR purpose IN ('transactional','marketing')",
            name="ck_messaging_message_purpose",
        ),
        sa.CheckConstraint(
            "state IN ('received','draft','queued','sending','accepted','sent','delivered','read','failed','uncertain','cancelled','suppressed')",
            name="ck_messaging_message_state",
        ),
    )
    op.create_table(
        TABLES[3],
        *identity(),
        sa.Column("binding_id", sa.Uuid(), nullable=False),
        sa.Column("dedupe_key", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("provider_message_id", sa.String(510), nullable=False),
        sa.Column("status", sa.String(16)),
        sa.Column("recipient", sa.String(256)),
        sa.Column("happened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("binding_id", "dedupe_key", name="uq_messaging_event_dedupe"),
        fk_binding(),
    )
    for table in TABLES:
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.create_index(f"ix_{table}_branch_id", table, ["branch_id"])
        op.execute(f"""ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
          ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
          CREATE POLICY tenant_isolation ON {table} FOR ALL
            USING (tenant_id::text=current_setting('app.tenant_id',true))
            WITH CHECK (tenant_id::text=current_setting('app.tenant_id',true));
          REVOKE ALL ON {table} FROM PUBLIC;
          DO $$ DECLARE r text; BEGIN
            FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
              IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON {table} FROM %I',r); END IF;
            END LOOP;
            IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT ON {table} TO kova_app; END IF;
          END $$;""")
    op.create_index("ix_messaging_messages_conversation_id", TABLES[2], ["conversation_id"])
    op.execute("""DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
      GRANT INSERT ON messaging_conversations,messaging_messages,messaging_channel_events TO kova_app;
      GRANT UPDATE(customer_id,status,automation_paused,assigned_user_id,last_inbound_at,version,updated_at) ON messaging_conversations TO kova_app;
      GRANT UPDATE(state,binding_id,provider_message_id,contact_fingerprint,version,error_code,updated_at) ON messaging_messages TO kova_app;
    END IF; END $$;""")


def downgrade():
    op.execute(
        "DO $$ BEGIN IF "
        + " OR ".join(f"EXISTS(SELECT 1 FROM {table})" for table in TABLES)
        + " THEN RAISE EXCEPTION 'Preserve messaging history before downgrade'; END IF; END $$;"
    )
    for table in reversed(TABLES):
        op.drop_table(table)
    op.drop_constraint("uq_automation_run_owner", "automation_runs", type_="unique")

"""Private tenant assistant resources, hybrid retrieval and shared quota metadata."""

from alembic import op

revision = "0075_assistant"
down_revision = "0074_cfdi_documents"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE SCHEMA IF NOT EXISTS extensions")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions")
    op.execute("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
                       WHERE e.extname='vector' AND n.nspname='extensions') THEN
            RAISE EXCEPTION 'vector must be in extensions schema; review deployment prerequisites';
        END IF;
    END $$""")
    op.execute("""CREATE TABLE assistant_records (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        branch_id uuid NOT NULL, parent_id uuid,
        kind varchar(24) NOT NULL CHECK (kind IN ('conversation','message','run','proposal',
            'document','memory','goal','task','preferences','mail','reservation')),
        status varchar(32) NOT NULL DEFAULT 'ready', shared boolean NOT NULL DEFAULT false,
        dedupe_key varchar(160), data jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz, UNIQUE (tenant_id,id),
        UNIQUE (tenant_id,owner_user_id,kind,dedupe_key),
        FOREIGN KEY (tenant_id,branch_id) REFERENCES branches(tenant_id,id),
        FOREIGN KEY (tenant_id,parent_id) REFERENCES assistant_records(tenant_id,id) ON DELETE CASCADE,
        CHECK (NOT shared OR kind IN ('document','memory','goal'))
    )""")
    op.execute(
        "CREATE INDEX ix_assistant_owner_kind ON assistant_records (tenant_id,owner_user_id,kind,created_at)"
    )
    op.execute(
        "CREATE INDEX ix_assistant_jobs ON assistant_records (tenant_id,kind,status,updated_at)"
    )
    op.execute("CREATE INDEX ix_assistant_parent ON assistant_records (tenant_id,parent_id)")
    op.execute("""CREATE TABLE assistant_chunks (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, document_id uuid NOT NULL,
        position integer NOT NULL, page integer NOT NULL, content text NOT NULL,
        embedding extensions.vector(1024),
        FOREIGN KEY (tenant_id,document_id) REFERENCES assistant_records(tenant_id,id) ON DELETE CASCADE,
        UNIQUE (tenant_id,document_id,position)
    )""")
    op.execute("CREATE INDEX ix_assistant_chunks_doc ON assistant_chunks (tenant_id,document_id)")
    op.execute(
        "CREATE INDEX ix_assistant_chunks_fts ON assistant_chunks USING gin (to_tsvector('spanish',content))"
    )
    # Canonical tenant policy remains mandatory. ACLs are restrictive, so no OR
    # combination can make a private record visible through tenant membership.
    for table in ("assistant_records", "assistant_chunks"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        predicate = "tenant_id::text = current_setting('app.tenant_id', true)"
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} USING ({predicate}) WITH CHECK ({predicate})"
        )
    owner = "owner_user_id::text = current_setting('app.assistant_user_id', true)"
    op.execute(
        f"CREATE POLICY assistant_private_read ON assistant_records AS RESTRICTIVE FOR SELECT USING ({owner} OR shared)"
    )
    for command in ("INSERT", "UPDATE", "DELETE"):
        using = f"USING ({owner})" if command != "INSERT" else ""
        check = f"WITH CHECK ({owner})" if command != "DELETE" else ""
        op.execute(
            f"CREATE POLICY assistant_private_{command.lower()} ON assistant_records AS RESTRICTIVE FOR {command} {using} {check}"
        )
    visible = "EXISTS (SELECT 1 FROM assistant_records r WHERE r.id=document_id AND r.tenant_id=assistant_chunks.tenant_id AND r.kind='document' AND (r.status='ready' OR r.owner_user_id::text=current_setting('app.assistant_user_id',true)))"
    op.execute(
        f"CREATE POLICY assistant_chunk_read ON assistant_chunks AS RESTRICTIVE FOR SELECT USING ({visible})"
    )
    writable = f"EXISTS (SELECT 1 FROM assistant_records r WHERE r.id=document_id AND r.tenant_id=assistant_chunks.tenant_id AND {owner.replace('owner_user_id', 'r.owner_user_id')})"
    for command in ("INSERT", "UPDATE", "DELETE"):
        using = f"USING ({writable})" if command != "INSERT" else ""
        check = f"WITH CHECK ({writable})" if command != "DELETE" else ""
        op.execute(
            f"CREATE POLICY assistant_chunk_{command.lower()} ON assistant_chunks AS RESTRICTIVE FOR {command} {using} {check}"
        )
    op.execute("CREATE SCHEMA assistant_control")
    op.execute("""CREATE TABLE assistant_control.allocations (
        period_key text PRIMARY KEY, data jsonb NOT NULL
    )""")
    op.execute("""CREATE TABLE assistant_control.objects (
        id uuid PRIMARY KEY REFERENCES assistant_records(id) ON DELETE CASCADE,
        tenant_key uuid NOT NULL, bytes bigint NOT NULL CHECK (bytes>0 AND bytes<=20971520)
    )""")
    op.execute("CREATE INDEX ix_assistant_object_tenant ON assistant_control.objects(tenant_key)")
    op.execute("""CREATE TABLE assistant_control.events (
        tenant_key uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        happened_at timestamptz NOT NULL
    )""")

    op.execute("REVOKE ALL ON SCHEMA assistant_control FROM PUBLIC")
    op.execute("""CREATE TABLE assistant_control.budgets (
        period_key text NOT NULL, bucket text NOT NULL, used bigint NOT NULL CHECK (used>=0),
        PRIMARY KEY (period_key,bucket)
    )""")
    op.execute("""CREATE TABLE assistant_control.slots (
        id uuid PRIMARY KEY, tenant_key uuid NOT NULL, user_key uuid NOT NULL,
        expires_at timestamptz NOT NULL
    )""")
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_records,assistant_chunks TO kova_app;
            GRANT USAGE ON SCHEMA assistant_control,extensions TO kova_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA assistant_control TO kova_app;
            GRANT EXECUTE ON FUNCTION extensions.cosine_distance(extensions.vector,extensions.vector) TO kova_app;
        END IF;
    END $$""")
    op.execute("REVOKE ALL ON assistant_records,assistant_chunks FROM PUBLIC")
    op.execute("""DO $$ DECLARE r text; BEGIN
        FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
                EXECUTE format('REVOKE ALL ON assistant_records,assistant_chunks FROM %I',r);
                EXECUTE format('REVOKE ALL ON SCHEMA assistant_control FROM %I',r);
            END IF;
        END LOOP;
    END $$""")


def downgrade():
    # A rollback of application code leaves additive assistant data intact.
    op.execute(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM assistant_records) THEN RAISE EXCEPTION 'assistant data exists; disable flags instead of downgrading'; END IF; END $$"
    )
    op.execute("DROP SCHEMA assistant_control CASCADE")
    op.execute("DROP TABLE assistant_chunks")
    op.execute("DROP TABLE assistant_records")

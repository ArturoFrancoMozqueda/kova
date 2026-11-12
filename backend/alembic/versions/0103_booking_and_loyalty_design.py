"""Opt-in public scheduling and loyalty presentation; no changes to existing records."""

from alembic import op

revision = "0103_booking_and_loyalty_design"
down_revision = "0102_whatsapp_signup"
branch_labels = None
depends_on = None

TABLES = {
    "loyalty_appearances": """
        color varchar(7) NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
        use_business_logo boolean NOT NULL, version integer NOT NULL CHECK(version >= 1),
        UNIQUE(tenant_id,branch_id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
    """,
    "booking_pages": """
        enabled boolean NOT NULL DEFAULT false, version integer NOT NULL CHECK(version >= 1),
        link_version integer NOT NULL CHECK(link_version >= 1),
        horizon_days integer NOT NULL CHECK(horizon_days BETWEEN 1 AND 366),
        notice_minutes integer NOT NULL CHECK(notice_minutes BETWEEN 0 AND 525600),
        slot_minutes integer NOT NULL CHECK(slot_minutes BETWEEN 5 AND 120),
        manage_cutoff_hours integer NOT NULL CHECK(manage_cutoff_hours BETWEEN 0 AND 720),
        authorized_by_user_id uuid NOT NULL,
        UNIQUE(tenant_id,branch_id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
        FOREIGN KEY(tenant_id,authorized_by_user_id) REFERENCES memberships(tenant_id,user_id)
    """,
    "booking_services": """
        name varchar(160) NOT NULL CHECK(length(trim(name)) > 0), description varchar(500) NOT NULL,
        duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 1440),
        is_active boolean NOT NULL, version integer NOT NULL CHECK(version >= 1),
        UNIQUE(tenant_id,branch_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
    """,
    "booking_service_resources": """
        service_id uuid NOT NULL, resource_id uuid NOT NULL,
        UNIQUE(tenant_id,branch_id,service_id,resource_id),
        FOREIGN KEY(tenant_id,branch_id,service_id) REFERENCES booking_services(tenant_id,branch_id,id),
        FOREIGN KEY(tenant_id,branch_id,resource_id) REFERENCES appointment_resources(tenant_id,branch_id,id)
    """,
    "booking_availability": """
        resource_id uuid NOT NULL, weekly jsonb NOT NULL, exceptions jsonb NOT NULL,
        version integer NOT NULL CHECK(version >= 1), UNIQUE(tenant_id,branch_id,resource_id),
        FOREIGN KEY(tenant_id,branch_id,resource_id) REFERENCES appointment_resources(tenant_id,branch_id,id)
    """,
    "public_bookings": """
        service_id uuid NOT NULL, resource_id uuid NOT NULL, customer_id uuid, appointment_id uuid UNIQUE,
        guest_name varchar(160) NOT NULL, phone varchar(30) NOT NULL, title varchar(160) NOT NULL,
        timezone varchar(48) NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
        status varchar(16) NOT NULL CHECK(status IN ('scheduled','cancelled')),
        version integer NOT NULL CHECK(version >= 1), manage_version integer NOT NULL CHECK(manage_version >= 1),
        operation_hash varchar(64) NOT NULL UNIQUE, request_hash varchar(64) NOT NULL,
        created_at timestamptz NOT NULL, UNIQUE(tenant_id,branch_id,id),
        CHECK(ends_at > starts_at AND ends_at <= starts_at + interval '24 hours'),
        FOREIGN KEY(tenant_id,branch_id,service_id) REFERENCES booking_services(tenant_id,branch_id,id),
        FOREIGN KEY(tenant_id,branch_id,resource_id) REFERENCES appointment_resources(tenant_id,branch_id,id),
        FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id),
        FOREIGN KEY(tenant_id,branch_id,appointment_id) REFERENCES appointments(tenant_id,branch_id,id)
    """,
    "booking_history": """
        booking_id uuid NOT NULL, version integer NOT NULL, action varchar(32) NOT NULL,
        actor_user_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL, status varchar(16) NOT NULL, details text NOT NULL,
        UNIQUE(booking_id,version),
        FOREIGN KEY(tenant_id,branch_id,booking_id) REFERENCES public_bookings(tenant_id,branch_id,id),
        FOREIGN KEY(tenant_id,actor_user_id) REFERENCES memberships(tenant_id,user_id)
    """,
}
UPDATES = {
    "loyalty_appearances": "color,use_business_logo,version",
    "booking_pages": "enabled,version,link_version,horizon_days,notice_minutes,slot_minutes,manage_cutoff_hours,authorized_by_user_id",
    "booking_services": "name,description,duration_minutes,is_active,version",
    "booking_availability": "weekly,exceptions,version",
    "public_bookings": "customer_id,appointment_id,starts_at,ends_at,status,version,manage_version",
}


def upgrade():
    for table, fields in TABLES.items():
        op.execute(
            f"CREATE TABLE {table} (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, {fields})"
        )
        op.execute(f"CREATE INDEX ix_{table}_tenant_id ON {table}(tenant_id)")
        op.execute(f"CREATE INDEX ix_{table}_branch_id ON {table}(branch_id)")
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} FOR ALL USING (tenant_id::text = current_setting('app.tenant_id',true)) WITH CHECK (tenant_id::text = current_setting('app.tenant_id',true))"
        )
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
        for role in ("anon", "authenticated", "service_role"):
            op.execute(
                f"DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN REVOKE ALL ON {table} FROM {role}; END IF; END $$"
            )
        extra = (
            f" GRANT UPDATE({UPDATES[table]}) ON {table} TO kova_app;" if table in UPDATES else ""
        )
        # Assignment replacement is the only runtime deletion in these new tables.
        if table == "booking_service_resources":
            extra += f" GRANT DELETE ON {table} TO kova_app;"
        op.execute(
            f"DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='kova_app') THEN GRANT SELECT,INSERT ON {table} TO kova_app;{extra} END IF; END $$"
        )
    op.execute(
        "CREATE INDEX ix_public_bookings_occupied ON public_bookings(tenant_id,branch_id,resource_id,starts_at,ends_at) WHERE status='scheduled' AND appointment_id IS NULL"
    )


def downgrade():
    for table in reversed(TABLES):
        op.execute(
            f"DO $$ BEGIN IF EXISTS(SELECT 1 FROM {table}) THEN RAISE EXCEPTION 'Cannot discard scheduling or loyalty history'; END IF; END $$"
        )
    for table in reversed(TABLES):
        op.drop_table(table)

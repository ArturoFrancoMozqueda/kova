from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0065_tenant_hardening import (
    _run_alembic,
    _run_provision,
    _temporary_database,
)
from migration_tests.test_0068_branches import _migrate


def test_notice_migration_is_private_additive_and_round_trips_empty():
    with _temporary_database() as (url, engine):
        _run_alembic(url, "0106_whatsapp_coexistence")
        _run_alembic(url, "0107_reservation_notices")
        _run_provision(url)
        with engine.connect() as conn:
            assert conn.execute(
                text(
                    "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                    "WHERE relname='messaging_reservation_notices'"
                )
            ).one() == (True, True)
            for role in ("anon", "authenticated", "service_role"):
                assert not conn.scalar(
                    text(
                        "SELECT has_table_privilege(:role,'messaging_reservation_notices','SELECT')"
                    ),
                    {"role": role},
                )
            assert conn.scalar(
                text(
                    "SELECT has_table_privilege('kova_app',"
                    "'messaging_reservation_notices','INSERT')"
                )
            )
            assert conn.scalar(
                text(
                    "SELECT has_column_privilege('kova_app','messaging_reservation_notices',"
                    "'state','UPDATE')"
                )
            )
            for column in (
                "tenant_id",
                "branch_id",
                "snapshot_hash",
                "recipient_hash",
                "due_at",
                "kind",
            ):
                assert not conn.scalar(
                    text(
                        "SELECT has_column_privilege('kova_app','messaging_reservation_notices',"
                        ":column,'UPDATE')"
                    ),
                    {"column": column},
                )
        result = _migrate(
            url.render_as_string(hide_password=False), "downgrade", "0106_whatsapp_coexistence"
        )
        assert result.returncode == 0, result.stderr
        _run_alembic(url, "0107_reservation_notices")
        tenant = uuid4()
        with engine.begin() as conn:
            for statement in (
                "INSERT INTO tenants(id,name,slug) VALUES(:id,'Reservas',:slug)",
                "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                "VALUES(:id,:email,'test-only',true)",
                "INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')",
                "INSERT INTO customers(id,tenant_id,name) VALUES(:id,:id,'Cliente')",
                "INSERT INTO appointment_resources(id,tenant_id,branch_id,name,timezone,"
                "is_active,version,created_at,updated_at) VALUES(:id,:id,:id,'Cabina',"
                "'America/Mexico_City',true,1,now(),now())",
                "INSERT INTO appointments(id,tenant_id,branch_id,resource_id,customer_id,title,"
                "starts_at,ends_at,status,version,created_by_user_id,created_at,updated_at) "
                "VALUES(:id,:id,:id,:id,:id,'Cita',now()+interval '2 days',"
                "now()+interval '49 hours','scheduled',1,:id,now(),now())",
                "INSERT INTO messaging_reservation_notices(id,tenant_id,branch_id,appointment_id,"
                "source_revision,snapshot_hash,recipient_hash,kind,state,starts_at,due_at,"
                "created_at) VALUES(:id,:id,:id,:id,'1:0',:hash,:hash,'confirmation',"
                "'prepared',now()+interval '2 days',now(),now())",
            ):
                conn.execute(
                    text(statement),
                    {
                        "id": tenant,
                        "slug": str(tenant),
                        "email": f"{tenant}@example.com",
                        "hash": "a" * 64,
                    },
                )
        refused = _migrate(
            url.render_as_string(hide_password=False), "downgrade", "0106_whatsapp_coexistence"
        )
        assert refused.returncode != 0
        assert "Retain reservation notice history" in refused.stderr

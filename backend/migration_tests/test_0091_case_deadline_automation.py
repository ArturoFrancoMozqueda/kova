"""Extending the template catalog retains historical data and guarded rollback."""

from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate


def test_case_deadline_catalog_empty_downgrade_is_reversible():
    with _database() as (url, engine):
        assert _migrate(url, "upgrade", "0091_case_deadline_automation").returncode == 0
        with engine.connect() as conn:
            for table in ("automation_rules", "business_events", "automation_runs"):
                assert tuple(
                    conn.execute(
                        text(
                            "SELECT relrowsecurity,relforcerowsecurity "
                            "FROM pg_class WHERE relname=:name"
                        ),
                        {"name": table},
                    ).one()
                ) == (True, True)
        assert _migrate(url, "downgrade", "0090_service_cases").returncode == 0
        assert _migrate(url, "upgrade", "0091_case_deadline_automation").returncode == 0


def test_case_deadline_catalog_downgrade_cannot_discard_opt_in_history():
    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", "0091_case_deadline_automation")
        assert upgraded.returncode == 0, upgraded.stderr
        tenant = uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Deadline',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                    "VALUES(:id,:email,'test-only',true)"
                ),
                {"id": tenant, "email": f"deadline-{tenant}@example.com"},
            )
            conn.execute(
                text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
                {"id": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO automation_rules(id,tenant_id,branch_id,template_key,"
                    "enabled,version,authorized_by_user_id,created_at,updated_at) "
                    "VALUES(:id,:id,:id,'service_case_overdue',false,1,:id,now(),now())"
                ),
                {"id": tenant},
            )
        blocked = _migrate(url, "downgrade", "0090_service_cases")
        assert blocked.returncode != 0
        assert "Cannot discard service case deadline automation history" in blocked.stderr
        with engine.connect() as conn:
            assert (
                conn.scalar(
                    text("SELECT count(*) FROM automation_rules WHERE id=:id"), {"id": tenant}
                )
                == 1
            )

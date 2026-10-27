"""Device credentials remain private and consent history cannot be discarded."""

from uuid import uuid4

from sqlalchemy import text

from migration_tests.test_0068_branches import _database, _migrate


def test_public_membership_empty_downgrade_and_private_rls():
    with _database() as (url, engine):
        upgraded = _migrate(url, "upgrade", "0098_public_loyalty_enrollment")
        assert upgraded.returncode == 0, upgraded.stderr
        with engine.connect() as conn:
            for table in ("loyalty_members", "loyalty_enrollment_policies"):
                assert conn.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity "
                        "FROM pg_class WHERE relname=:name"
                    ),
                    {"name": table},
                ).one() == (True, True)
                assert not conn.scalar(
                    text("SELECT has_table_privilege('public', :name, 'SELECT')"), {"name": table}
                )
        downgraded = _migrate(url, "downgrade", "0097_loyalty_pos_rewards")
        assert downgraded.returncode == 0, downgraded.stderr
        assert _migrate(url, "upgrade", "0098_public_loyalty_enrollment").returncode == 0


def test_public_membership_nonempty_consent_blocks_downgrade():
    with _database() as (url, engine):
        result = _migrate(url, "upgrade", "0098_public_loyalty_enrollment")
        assert result.returncode == 0, result.stderr
        tenant, policy = uuid4(), uuid4()
        with engine.begin() as conn:
            conn.execute(
                text("INSERT INTO tenants(id,name,slug) VALUES(:id,'Consent history',:slug)"),
                {"id": tenant, "slug": str(tenant)},
            )
            conn.execute(
                text(
                    "INSERT INTO users(id,email,hashed_password,is_email_verified) "
                    "VALUES(:id,:email,'test-only',true)"
                ),
                {"id": tenant, "email": f"enroll-{tenant}@example.com"},
            )
            conn.execute(
                text("INSERT INTO memberships(tenant_id,user_id,role) VALUES(:id,:id,'owner')"),
                {"id": tenant},
            )
            conn.execute(
                text(
                    "INSERT INTO loyalty_enrollment_policies(id,tenant_id,branch_id,"
                    "version,enabled,"
                    "authorized_by_user_id,created_at) "
                    "VALUES(:id,:tenant,:tenant,1,true,:tenant,now())"
                ),
                {"id": policy, "tenant": tenant},
            )
        blocked = _migrate(url, "downgrade", "0097_loyalty_pos_rewards")
        assert blocked.returncode != 0
        assert "Cannot discard public loyalty membership or consent" in blocked.stderr
        with engine.connect() as conn:
            assert (
                conn.scalar(
                    text("SELECT enabled FROM loyalty_enrollment_policies WHERE id=:id"),
                    {"id": policy},
                )
                is True
            )

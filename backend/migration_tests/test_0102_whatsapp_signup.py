"""Additive credentials, real tenant RLS and guarded rollback on disposable Postgres."""

from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from migration_tests.test_0068_branches import _database, _migrate
from testing_roles import KOVA_APP_TEST_PASSWORD, provision_test_runtime_role

REVISION = "0102_whatsapp_signup"
BASELINE = "0101_checkout_attempts"
TABLES = ("messaging_channel_connections", "messaging_signup_sessions")


def test_empty_roundtrip_and_real_rls_preserve_runtime_read_only_ownership():
    with _database() as (url, engine):
        provision_test_runtime_role(url)
        for command, revision in [
            ("upgrade", REVISION),
            ("downgrade", BASELINE),
            ("upgrade", REVISION),
        ]:
            result = _migrate(url, command, revision)
            assert result.returncode == 0, result.stderr
        tenants = [uuid4(), uuid4()]
        with engine.begin() as db:
            for index, tenant in enumerate(tenants):
                actor, binding, session = uuid4(), uuid4(), uuid4()
                db.execute(
                    text("INSERT INTO tenants(id,name,slug) VALUES(:id,'WA test',:slug)"),
                    {"id": tenant, "slug": f"wa-{tenant}"},
                )
                db.execute(
                    text(
                        "INSERT INTO users(id,email,hashed_password) VALUES(:id,:email,'synthetic')"
                    ),
                    {"id": actor, "email": f"wa-{actor}@example.com"},
                )
                db.execute(
                    text(
                        "INSERT INTO memberships(tenant_id,user_id,role) "
                        "VALUES(:tenant,:actor,'owner')"
                    ),
                    {"tenant": tenant, "actor": actor},
                )
                db.execute(
                    text(
                        "INSERT INTO messaging_channel_bindings(id,tenant_id,branch_id,waba_id,"
                        "phone_number_id,verified_at,enabled,created_at) "
                        "VALUES(:id,:tenant,:tenant,'987',"
                        ":phone,now(),true,now())"
                    ),
                    {"id": binding, "tenant": tenant, "phone": f"65{index}"},
                )
                db.execute(
                    text(
                        "INSERT INTO messaging_channel_connections(binding_id,tenant_id,branch_id,"
                        "encrypted_credentials,updated_at) "
                        "VALUES(:binding,:tenant,:tenant,'synthetic-encrypted',now())"
                    ),
                    {"binding": binding, "tenant": tenant},
                )
                db.execute(
                    text(
                        "INSERT INTO messaging_signup_sessions(id,tenant_id,branch_id,actor_id,"
                        "nonce_hash,state,expires_at,created_at,updated_at) "
                        "VALUES(:id,:tenant,:tenant,:actor,"
                        ":hash,'pending',now()+interval '10 minutes',now(),now())"
                    ),
                    {"id": session, "tenant": tenant, "actor": actor, "hash": "a" * 64},
                )
            for table in TABLES:
                assert db.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class "
                        "WHERE relname=:table"
                    ),
                    {"table": table},
                ).one() == (True, True)
        runtime = create_engine(
            make_url(url).set(username="kova_app", password=KOVA_APP_TEST_PASSWORD)
        )
        try:
            for tenant in [None, *tenants]:
                with runtime.begin() as db:
                    db.execute(
                        text("SELECT set_config('app.tenant_id',:tenant,true)"),
                        {"tenant": str(tenant) if tenant else ""},
                    )
                    for table in TABLES:
                        rows = db.execute(text(f"SELECT tenant_id FROM {table}")).scalars().all()
                        assert rows == ([tenant] if tenant else [])
                        for permission in ["INSERT", "UPDATE", "DELETE"]:
                            assert not db.execute(
                                text("SELECT has_table_privilege(current_user,:table,:permission)"),
                                {"table": table, "permission": permission},
                            ).scalar()
            refused = _migrate(url, "downgrade", BASELINE)
            assert refused.returncode != 0
            assert "retain credentials before downgrade" in refused.stderr
            with engine.connect() as db:
                assert (
                    db.execute(text("SELECT count(*) FROM messaging_channel_connections")).scalar()
                    == 2
                )
        finally:
            runtime.dispose()

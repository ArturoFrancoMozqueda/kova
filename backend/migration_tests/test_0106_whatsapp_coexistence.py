"""Upgrade/downgrade, real RLS and immutable ownership on disposable PostgreSQL."""

from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from migration_tests.test_0068_branches import _database, _migrate
from testing_roles import KOVA_APP_TEST_PASSWORD, provision_test_runtime_role

REVISION = "0106_whatsapp_coexistence"
BASELINE = "0105_inventory_read_indexes"
TABLES = ("messaging_app_sync", "messaging_app_contacts", "messaging_webhook_batches")


def test_roundtrip_rls_and_guarded_downgrade_keep_data_and_credentials_safe():
    with _database() as (url, engine):
        provision_test_runtime_role(url)
        for command, revision in [
            ("upgrade", REVISION),
            ("downgrade", BASELINE),
            ("upgrade", REVISION),
        ]:
            result = _migrate(url, command, revision)
            assert result.returncode == 0, result.stderr
        tenants, bindings = [uuid4(), uuid4()], [uuid4(), uuid4()]
        with engine.begin() as db:
            for index, (tenant, binding) in enumerate(zip(tenants, bindings, strict=True)):
                db.execute(
                    text("INSERT INTO tenants(id,name,slug) VALUES(:t,'App test',:slug)"),
                    {"t": tenant, "slug": str(tenant)},
                )
                db.execute(
                    text(
                        "INSERT INTO messaging_channel_bindings(id, tenant_id, branch_id, "
                        "waba_id, phone_number_id, verified_at, enabled, created_at) VALUES(:b, "
                        ":t, :t, '987', :p, now(), true, now())"
                    ),
                    {"b": binding, "t": tenant, "p": f"65{index}"},
                )
                db.execute(
                    text(
                        "INSERT INTO messaging_app_sync(binding_id, tenant_id, branch_id, "
                        "contacts_state, history_state, progress, started_at, updated_at) "
                        "VALUES(:b, :t, :t, 'requested', 'requested', 0, now(), now())"
                    ),
                    {"b": binding, "t": tenant},
                )
                db.execute(
                    text(
                        "INSERT INTO messaging_app_contacts(id, binding_id, tenant_id, "
                            "branch_id, "
                        "external_party, name, removed, changed_at) VALUES(:id, :b, :t, :t, "
                        "'525512345678', 'Synthetic', false, now())"
                    ),
                    {"id": uuid4(), "b": binding, "t": tenant},
                )
                db.execute(
                    text(
                        "INSERT INTO messaging_webhook_batches(id, binding_id, tenant_id, "
                        "branch_id, payload_hash, encrypted_payload, cursor, state, created_at) "
                        "VALUES(:id, :b, :t, :t, :hash, 'synthetic-encrypted', 0, 'pending', "
                        "now())"
                    ),
                    {"id": uuid4(), "b": binding, "t": tenant, "hash": str(index) * 64},
                )
            for table in TABLES:
                assert db.execute(
                    text(
                        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=:t"
                    ),
                    {"t": table},
                ).one() == (True, True)
        runtime = create_engine(
            make_url(url).set(username="kova_app", password=KOVA_APP_TEST_PASSWORD)
        )
        try:
            for tenant in [None, *tenants]:
                with runtime.begin() as db:
                    db.execute(
                        text("SELECT set_config('app.tenant_id',:t,true)"),
                        {"t": str(tenant) if tenant else ""},
                    )
                    for table in TABLES:
                        assert db.execute(
                            text(f"SELECT tenant_id FROM {table}")
                        ).scalars().all() == ([tenant] if tenant else [])
                        for column in ["tenant_id", "branch_id", "binding_id"]:
                            assert not db.execute(
                                text("SELECT has_column_privilege(current_user,:t,:c,'UPDATE')"),
                                {"t": table, "c": column},
                            ).scalar()
            with pytest.raises(DBAPIError):
                with runtime.begin() as db:
                    db.execute(
                        text("SELECT set_config('app.tenant_id',:t,true)"), {"t": str(tenants[0])}
                    )
                    db.execute(
                        text(
                            "INSERT INTO messaging_app_contacts(id, binding_id, tenant_id, "
                            "branch_id, "
                            "external_party, removed, changed_at) VALUES(:id, :b, :t, :t, "
                            "'525598765432', false, now())"
                        ),
                        {"id": uuid4(), "b": bindings[1], "t": tenants[1]},
                    )
            refused = _migrate(url, "downgrade", BASELINE)
            assert refused.returncode != 0 and "retain imported data" in refused.stderr
            with engine.connect() as db:
                assert db.execute(text("SELECT count(*) FROM messaging_app_sync")).scalar() == 2
        finally:
            runtime.dispose()

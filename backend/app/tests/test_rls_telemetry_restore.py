"""Accept only the two complete PostgreSQL renderings of the reviewed policy."""

from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app import db as database

SOURCE_EXPRESSION = """
((event_name)::text = ANY ((ARRAY[
 'landing_viewed'::character varying, 'landing_section_viewed'::character varying,
 'landing_story_step_viewed'::character varying, 'landing_cta_clicked'::character varying,
 'signup_started'::character varying, 'signup_validation_failed'::character varying,
 'experiment_exposed'::character varying, 'product_demo_viewed'::character varying,
 'product_demo_step_changed'::character varying, 'pricing_viewed'::character varying,
 'whatsapp_clicked'::character varying, 'login_clicked'::character varying,
 'faq_opened'::character varying])::text[])) AND NOT
 (properties::jsonb ?| ARRAY['tenant_id'::text,'user_id'::text,'email'::text,
 'name'::text,'phone'::text,'password'::text,'amount'::text,'total_amount'::text,
 'amount_minor_units'::text,'query'::text,'query_string'::text,'full_url'::text])
"""
RESTORED_EXPRESSION = """
((event_name)::text = ANY (ARRAY[
 ('landing_viewed'::character varying)::text, ('landing_section_viewed'::character varying)::text,
 ('landing_story_step_viewed'::character varying)::text,
 ('landing_cta_clicked'::character varying)::text, ('signup_started'::character varying)::text,
 ('signup_validation_failed'::character varying)::text,
 ('experiment_exposed'::character varying)::text, ('product_demo_viewed'::character varying)::text,
 ('product_demo_step_changed'::character varying)::text, ('pricing_viewed'::character varying)::text,
 ('whatsapp_clicked'::character varying)::text, ('login_clicked'::character varying)::text,
 ('faq_opened'::character varying)::text])) AND NOT
 (properties::jsonb ?| ARRAY['tenant_id'::text,'user_id'::text,'email'::text,
 'name'::text,'phone'::text,'password'::text,'amount'::text,'total_amount'::text,
 'amount_minor_units'::text,'query'::text,'query_string'::text,'full_url'::text])
"""
TABLE = "anonymous_telemetry_events"
POLICY = "anonymous_telemetry_events_insert"


def _posture(monkeypatch, expression, *, roles=(0,), command="a", extra=False):
    monkeypatch.setattr(database, "RLS_PROTECTED_TABLES", (TABLE,))
    policies = [(POLICY, True, command, roles, False, True, None, expression)]
    if extra:
        policies.append(("unexpected_access", True, "*", (0,), True, True, "true", "true"))
    return database._rls_posture_errors(
        role_is_super=False,
        role_bypasses_rls=False,
        owned_tables=set(),
        table_posture={TABLE: (True, True, False, True)},
        policy_catalog={TABLE: policies},
    )


@pytest.mark.parametrize("expression", [SOURCE_EXPRESSION, RESTORED_EXPRESSION])
def test_complete_reviewed_telemetry_forms_are_accepted(monkeypatch, expression):
    assert _posture(monkeypatch, expression) == []


@pytest.mark.parametrize(
    "expression",
    [
        "true",
        "1=1",
        SOURCE_EXPRESSION.replace(" AND NOT", " OR NOT"),
        RESTORED_EXPRESSION.replace(" AND NOT", " OR NOT"),
        RESTORED_EXPRESSION.replace("'signup_started'", "'signup_completed'"),
        RESTORED_EXPRESSION.replace("'email'::text,", ""),
        RESTORED_EXPRESSION.replace("?|", "?&"),
        RESTORED_EXPRESSION + " OR true",
        RESTORED_EXPRESSION + " AND properties::jsonb <> '{}'::jsonb",
        RESTORED_EXPRESSION.replace(
            "'landing_viewed'::character varying", "'landing_viewed'::varchar(500)"
        ),
        SOURCE_EXPRESSION.replace("'landing_viewed'::character varying", "'landing_viewed'::text"),
    ],
)
def test_telemetry_policy_mutations_are_not_normalized_into_trust(monkeypatch, expression):
    assert any("unsafe expression" in error for error in _posture(monkeypatch, expression))


@pytest.mark.parametrize("roles", [(42,), (0, 42), ()])
def test_reviewed_expression_does_not_authorize_new_roles(monkeypatch, roles):
    assert any(
        "unsafe scope" in error for error in _posture(monkeypatch, RESTORED_EXPRESSION, roles=roles)
    )


def test_reviewed_expression_does_not_authorize_other_commands_or_extra_policies(monkeypatch):
    assert any(
        "unsafe scope" in error for error in _posture(monkeypatch, RESTORED_EXPRESSION, command="*")
    )
    assert any(
        "unexpected permissive policies" in error
        for error in _posture(monkeypatch, RESTORED_EXPRESSION, extra=True)
    )


def test_live_startup_guard_accepts_dump_expression_reparsed_by_postgres(
    owner_engine,
    kova_app_engine,
    monkeypatch,
):
    # pg_dump emits pg_get_expr text; parsing it again creates the restored
    # per-element casts. DDL remains local to this disposable test transaction.
    with owner_engine.connect() as conn:
        transaction = conn.begin()
        try:
            expression = conn.scalar(
                text(
                    "SELECT pg_get_expr(polwithcheck,polrelid) FROM pg_policy "
                    "WHERE polrelid='public.anonymous_telemetry_events'::regclass "
                    "AND polname='anonymous_telemetry_events_insert'"
                )
            )
            assert expression
            conn.execute(
                text(
                    "ALTER POLICY anonymous_telemetry_events_insert "
                    "ON public.anonymous_telemetry_events WITH CHECK (" + expression + ")"
                )
            )
            restored = conn.scalar(
                text(
                    "SELECT pg_get_expr(polwithcheck,polrelid) FROM pg_policy "
                    "WHERE polrelid='public.anonymous_telemetry_events'::regclass "
                    "AND polname='anonymous_telemetry_events_insert'"
                )
            )
            def normalize(value):
                return "".join(c for c in value if not c.isspace() and c not in "()")

            assert normalize(restored) == normalize(RESTORED_EXPRESSION)
            conn.execute(text("SET LOCAL ROLE kova_app"))

            @contextmanager
            def connect():
                yield conn

            monkeypatch.setattr(database, "engine", SimpleNamespace(connect=connect))
            monkeypatch.setattr(database.settings, "app_env", "production")
            database.assert_rls_active()
        finally:
            transaction.rollback()

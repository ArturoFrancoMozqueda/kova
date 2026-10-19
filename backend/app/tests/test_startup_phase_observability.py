"""Phase timing adds no data and never substitutes a startup validation."""

import asyncio
import logging
import re
import sys
from types import ModuleType

import pytest

from app import main
from app.workers import bootstrap

MESSAGE = re.compile(r"startup_phase phase=[a-z_.]+ duration_ms=\d+\.\d{3}$")
GUARDS = (
    "configure_logging",
    "init_sentry",
    "_validate_config",
    "assert_rls_active",
    "assert_private_policies",
)


def _messages(caplog):
    records = [record for record in caplog.records if record.name == "app.startup"]
    assert all(MESSAGE.fullmatch(record.getMessage()) for record in records)
    assert all(record.exc_info is None and len(record.args) == 2 for record in records)
    return [record.args[0] for record in records]


def test_create_app_keeps_validation_order_and_records_only_static_phases(monkeypatch, caplog):
    calls = []
    for name in GUARDS:
        monkeypatch.setattr(main, name, lambda name=name: calls.append(name))
    original = main._construct_app
    # Other RBAC tests deliberately append private probe routes to main.app.
    # Compare fresh app instances so their shared global fixture cannot affect this check.
    reference = original()

    def construct():
        calls.append("construction")
        return original()

    monkeypatch.setattr(main, "_construct_app", construct)
    with caplog.at_level(logging.INFO, logger="app.startup"):
        app = main.create_app()
    assert calls == [*GUARDS, "construction"]
    assert _messages(caplog) == [
        "app.sentry_config",
        "app.rls_posture",
        "app.private_acl",
        "app.construction",
    ]
    assert {route.path for route in app.routes} == {route.path for route in reference.routes}
    assert [middleware.cls for middleware in app.user_middleware] == [
        middleware.cls for middleware in reference.user_middleware
    ]


@pytest.mark.parametrize("failure", GUARDS[1:])
def test_failed_startup_guard_still_aborts_and_never_logs_exception_payload(
    monkeypatch, caplog, failure
):
    calls = []
    error = RuntimeError("private@example.com secret=synthetic-private SQL SELECT tenant_id")

    def guard(name):
        calls.append(name)
        if name == failure:
            raise error

    for name in GUARDS:
        monkeypatch.setattr(main, name, lambda name=name: guard(name))
    monkeypatch.setattr(
        main, "_construct_app", lambda: pytest.fail("Startup continued after guard")
    )
    with caplog.at_level(logging.INFO, logger="app.startup"), pytest.raises(RuntimeError) as caught:
        main.create_app()
    assert caught.value is error
    assert calls == list(GUARDS[: GUARDS.index(failure) + 1])
    assert "app.construction" not in _messages(caplog)
    assert "synthetic-private" not in caplog.text
    assert "private@example.com" not in caplog.text
    assert "SELECT" not in caplog.text


def test_workers_initialization_times_real_startup_once_and_keeps_cached_app(monkeypatch, caplog):
    calls = []
    sentinel = object()
    environment = object()

    class ApiModule(ModuleType):
        def __getattr__(self, name):
            if name == "app":
                calls.append("import")
                return sentinel
            raise AttributeError(name)

    monkeypatch.setitem(sys.modules, "app.main", ApiModule("app.main"))
    monkeypatch.setattr(bootstrap, "_application", None)
    monkeypatch.setattr(bootstrap, "_initialization", asyncio.Lock())

    def configure(env):
        assert env is environment
        calls.append("configure")

    monkeypatch.setattr(bootstrap, "configure", configure)

    async def initialize():
        assert await bootstrap.application(environment) is sentinel
        assert await bootstrap.application(environment) is sentinel

    with caplog.at_level(logging.INFO, logger="app.startup"):
        asyncio.run(initialize())
    assert calls == ["configure", "import"]
    assert _messages(caplog) == ["workers.configure", "workers.app_main_import", "workers.total"]


def test_workers_failed_configuration_preserves_fail_closed_state(monkeypatch, caplog):
    error = RuntimeError("private-binding-value")
    monkeypatch.setattr(bootstrap, "_application", None)
    monkeypatch.setattr(bootstrap, "_initialization", asyncio.Lock())

    def fail(env):
        raise error

    monkeypatch.setattr(bootstrap, "configure", fail)
    with caplog.at_level(logging.INFO, logger="app.startup"), pytest.raises(RuntimeError) as caught:
        asyncio.run(bootstrap.application(object()))
    assert caught.value is error
    assert bootstrap._application is None
    assert _messages(caplog) == ["workers.configure", "workers.total"]
    assert "private-binding-value" not in caplog.text


def test_workers_early_phase_is_emitted_after_import_installs_logging(monkeypatch):
    enabled = False
    phases = []

    class Logger:
        def info(self, message, phase, duration):
            if enabled:
                phases.append(phase)
            assert message == "startup_phase phase=%s duration_ms=%.3f"
            assert isinstance(duration, float) and duration >= 0

    class ApiModule(ModuleType):
        def __getattr__(self, name):
            nonlocal enabled
            if name == "app":
                enabled = True  # create_app installs logging during this import.
                return object()
            raise AttributeError(name)

    monkeypatch.setitem(sys.modules, "app.main", ApiModule("app.main"))
    monkeypatch.setattr(bootstrap, "_startup_logger", Logger())
    monkeypatch.setattr(bootstrap, "_application", None)
    monkeypatch.setattr(bootstrap, "_initialization", asyncio.Lock())
    monkeypatch.setattr(bootstrap, "configure", lambda env: None)
    asyncio.run(bootstrap.application(object()))
    assert phases == ["workers.configure", "workers.app_main_import", "workers.total"]

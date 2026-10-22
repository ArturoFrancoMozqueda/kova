from app.observability import sentry


def test_workers_keeps_core_defaults_and_explicit_web_integrations(monkeypatch):
    captured = {}
    monkeypatch.setattr(sentry.settings, "sentry_dsn", "https://synthetic-public@sentry.test/1")
    monkeypatch.setattr(sentry.sys, "platform", "emscripten")
    monkeypatch.setattr(sentry.sentry_sdk, "init", lambda **kwargs: captured.update(kwargs))

    sentry.init_sentry()

    assert captured["auto_enabling_integrations"] is False
    assert "default_integrations" not in captured
    assert {item.identifier for item in captured["integrations"]} == {
        "fastapi", "starlette", "sqlalchemy", "httpx",
    }
    assert captured["transport"].__name__ == "WorkersTransport"
    assert captured["before_send"] is sentry.sanitize_sentry_event
    assert captured["send_default_pii"] is False
    assert captured["include_local_variables"] is False
    assert captured["traces_sample_rate"] == sentry.settings.sentry_traces_sample_rate


def test_native_sentry_retains_existing_autodetection_and_transport(monkeypatch):
    captured = {}
    monkeypatch.setattr(sentry.settings, "sentry_dsn", "https://synthetic-public@sentry.test/1")
    monkeypatch.setattr(sentry.sys, "platform", "linux")
    monkeypatch.setattr(sentry.sentry_sdk, "init", lambda **kwargs: captured.update(kwargs))

    sentry.init_sentry()

    for option in ("integrations", "auto_enabling_integrations", "default_integrations", "transport"):
        assert option not in captured
    assert captured["before_send"] is sentry.sanitize_sentry_event
    assert captured["send_default_pii"] is False
    assert captured["include_local_variables"] is False

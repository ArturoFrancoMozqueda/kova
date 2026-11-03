"""CI progress evidence cannot disclose request data or change thumbnail bytes."""

import io
import json

import pytest
from PIL import Image

from app.catalog import image_router as images
from app.observability.logging import request_id_var, tenant_id_var, user_id_var


@pytest.mark.parametrize("environment", ["production", "staging", "local", "CI"])
def test_photo_diagnostics_are_disabled_outside_exact_ci(monkeypatch, capsys, environment):
    monkeypatch.setattr(images.settings, "app_env", environment)
    monkeypatch.setattr(images, "thread_time", lambda: pytest.fail("read diagnostic clock"))
    with images._native_photo_phase("reduce"):
        pass
    assert capsys.readouterr().err == ""


def test_photo_diagnostics_reject_unbounded_phase_and_workers(monkeypatch, capsys):
    monkeypatch.setattr(images.settings, "app_env", "ci")
    with images._native_photo_phase("https://private.invalid/?token=never-log-this"):
        pass
    monkeypatch.setattr(images.sys, "platform", "emscripten")
    with images._native_photo_phase("reduce"):
        pass
    assert capsys.readouterr().err == ""


def test_ci_photo_progress_is_fixed_numeric_and_preserves_exception(monkeypatch, capsys):
    monkeypatch.setattr(images.settings, "app_env", "ci")
    contexts = [(variable, variable.set("identifier-never-log-this")) for variable in (
        request_id_var, tenant_id_var, user_id_var,
    )]
    try:
        with pytest.raises(RuntimeError, match="never-log-this"):
            with images._native_photo_phase("reduce"):
                raise RuntimeError("never-log-this customer@example.com https://private.invalid")
    finally:
        for variable, token in contexts:
            variable.reset(token)
    output = capsys.readouterr().err
    events = [json.loads(line) for line in output.splitlines()]
    assert [event["event"] for event in events] == ["begin", "error"]
    for event in events:
        assert set(event) == {"message", "phase", "event", "wall_ms", "thread_cpu_ms"}
        assert event["message"] == "native_photo_phase"
        assert event["phase"] == "reduce"
        assert isinstance(event["wall_ms"], (int, float)) and event["wall_ms"] >= 0
        assert isinstance(event["thread_cpu_ms"], (int, float)) and event["thread_cpu_ms"] >= 0
    assert "never-log-this" not in output and "private.invalid" not in output
    assert "customer@example.com" not in output


def test_ci_render_phases_preserve_exact_original_thumbnail_bytes(monkeypatch, capsys):
    with Image.new("RGBA", (803, 607), (20, 100, 220, 127)) as source:
        exif = Image.Exif()
        exif[274] = 6
        encoded = io.BytesIO()
        source.save(encoded, "PNG", exif=exif)
    monkeypatch.setattr(images.settings, "app_env", "production")
    expected = images._render_thumbnail(encoded.getvalue(), "image/png", 160)
    assert capsys.readouterr().err == ""
    monkeypatch.setattr(images.settings, "app_env", "ci")
    actual = images._render_thumbnail(encoded.getvalue(), "image/png", 160)
    events = [json.loads(line) for line in capsys.readouterr().err.splitlines()]
    assert actual == expected and actual[1] == "image/webp"
    assert [(event["phase"], event["event"]) for event in events] == [
        (phase, event) for phase in (
            "open", "decode_metadata", "decode_orientation", "reduce", "encode",
        ) for event in ("begin", "end")
    ]
    with Image.open(io.BytesIO(actual[0])) as thumbnail:
        assert thumbnail.size == (160, 211)
        assert thumbnail.getchannel("A").getextrema() == (127, 127)
        assert not thumbnail.getexif().get(274)

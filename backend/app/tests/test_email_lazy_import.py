import subprocess
import sys
from pathlib import Path

from app.email import service


def test_unrelated_startup_and_disabled_delivery_do_not_load_email_sdk():
    script = '''
import importlib.abc
import sys

class BlockEmailSdk(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "resend" or fullname.startswith("resend."):
            raise AssertionError("Email SDK loaded without an enabled delivery")

sys.meta_path.insert(0, BlockEmailSdk())
from app.email import service
service.settings.resend_api_key = None
assert service._send(to="qa@example.com", subject="Prueba", html="<p>Prueba</p>", kind="qa") is False
assert "resend" not in sys.modules
'''
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_lazy_delivery_preserves_provider_configuration_and_payload(monkeypatch):
    import resend

    sent = []
    monkeypatch.setattr(resend, "api_key", None)
    monkeypatch.setattr(service.settings, "resend_api_key", "re_synthetic_test_only")
    monkeypatch.setattr(service.settings, "email_from", "Kova QA <qa@example.com>")
    monkeypatch.setattr(resend.Emails, "send", lambda payload: sent.append(payload))

    assert service._send(
        to="customer@example.com", subject="Verifica tu correo", html="<p>Contenido</p>",
        kind="verification",
    ) is True
    assert resend.api_key == "re_synthetic_test_only"
    assert sent == [{
        "from": "Kova QA <qa@example.com>", "to": "customer@example.com",
        "subject": "Verifica tu correo", "html": "<p>Contenido</p>",
        "text": "Contenido", "reply_to": service.SUPPORT_EMAIL,
    }]


def test_lazy_delivery_keeps_provider_failures_as_unsent(monkeypatch):
    import resend

    def unavailable(payload):
        raise RuntimeError("synthetic transport unavailable")

    monkeypatch.setattr(resend, "api_key", None)
    monkeypatch.setattr(service.settings, "resend_api_key", "re_synthetic_test_only")
    monkeypatch.setattr(resend.Emails, "send", unavailable)
    assert service._send(
        to="qa@example.com", subject="Prueba", html="<p>Prueba</p>", kind="verification",
    ) is False

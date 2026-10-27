import logging
from pathlib import Path

import pytest

from app.email import service
from app.email.templates import SUPPORT_EMAIL


@pytest.fixture
def sent_mail(monkeypatch):
    import resend

    sent = []
    monkeypatch.setattr(service.settings, "resend_api_key", "re_synthetic_test_only")
    monkeypatch.setattr(service.settings, "email_from", "Kova QA <qa@example.invalid>")
    monkeypatch.setattr(service.settings, "frontend_url", "https://qa.kova.invalid")
    monkeypatch.setattr(resend.Emails, "send", lambda payload: sent.append(payload))
    return sent


@pytest.mark.parametrize(
    "function,kwargs,subject,content,links",
    [
        (
            service.send_verification_email,
            {"token": "qa-invalid-verification"},
            "Verifica tu correo — Kova",
            ["Verifica tu correo", "24 horas"],
            ["https://qa.kova.invalid/verify-email?token=qa-invalid-verification"],
        ),
        (
            service.send_welcome_email,
            {},
            "Tu plan Kova está activo",
            ["Tu plan Kova está activo"],
            ["https://qa.kova.invalid/dashboard", "https://qa.kova.invalid/settings/billing"],
        ),
        (
            service.send_payment_receipt_email,
            {
                "amount_minor_units": 123450,
                "currency": "mxn",
                "invoice_number": "QA-ÁRBOL-001",
                "invoice_url": "https://stripe.test/recibo?folio=QA-001&vista=texto",
                "period_end_iso": "2026-11-26",
            },
            "Recibo de pago — Kova",
            ["$1,234.50 MXN", "QA-ÁRBOL-001", "2026-11-26"],
            [
                "https://stripe.test/recibo?folio=QA-001&vista=texto",
                "https://qa.kova.invalid/settings/billing",
            ],
        ),
        (
            service.send_trial_ending_email,
            {"trial_ends_iso": "2026-11-26"},
            "Tu periodo de prueba de Kova termina pronto",
            ["Tu prueba termina pronto", "2026-11-26"],
            ["https://qa.kova.invalid/settings/billing"],
        ),
        (
            service.send_invitation_email,
            {
                "token": "qa-invalid-invitation",
                "tenant_name": "Café & Pan ☕ <QA>",
                "role": "cashier",
                "invited_by_email": "owner@example.invalid",
            },
            "Te invitaron a Café & Pan ☕ <QA> en Kova",
            ["Café & Pan ☕ <QA>", "Cajero", "7 días"],
            ["https://qa.kova.invalid/accept-invite?token=qa-invalid-invitation"],
        ),
        (
            service.send_password_reset_email,
            {"token": "qa-invalid-reset"},
            "Restablece tu contraseña — Kova",
            ["Restablece tu contraseña", "1 hora"],
            ["https://qa.kova.invalid/reset-password?token=qa-invalid-reset"],
        ),
    ],
)
def test_six_templates_keep_destination_subject_money_unicode_and_action_links(
    sent_mail, function, kwargs, subject, content, links
):
    result = function(to="recipient@example.invalid", **kwargs)
    if function is service.send_trial_ending_email:
        assert result is True
    assert len(sent_mail) == 1
    mail = sent_mail[0]
    assert mail["to"] == "recipient@example.invalid"
    assert mail["from"] == "Kova QA <qa@example.invalid>"
    assert mail["subject"] == subject
    assert mail["reply_to"] == SUPPORT_EMAIL
    assert mail["text"] and "<html" not in mail["text"]
    for item in content + links:
        assert item in mail["text"]
    if function is service.send_invitation_email:
        assert "tienes una cuenta activa" not in mail["text"]
        assert "te invitaron a un negocio que usa Kova" in mail["text"]
        assert "Café &amp; Pan ☕ &lt;QA&gt;" in mail["html"]


def test_reply_destination_matches_the_public_beta_support_source():
    support = Path(__file__).resolve().parents[3] / "frontend/src/lib/support.ts"
    assert f'export const SUPPORT_EMAIL = "{SUPPORT_EMAIL}";' in support.read_text()


def test_provider_failures_log_only_a_fixed_category_without_addresses_tokens_or_payload(
    sent_mail, monkeypatch, caplog
):
    import resend

    private = "recipient@example.invalid qa-auth-token https://qa.kova.invalid/reset-password?token=qa-auth-token re_synthetic_test_only"

    def reject(_payload):
        raise RuntimeError(private)

    monkeypatch.setattr(resend.Emails, "send", reject)
    with caplog.at_level(logging.INFO, logger="app.email.service"):
        assert (
            service._send(
                to="recipient@example.invalid",
                subject="Private subject",
                html=f"<p>{private}</p>",
                kind="password_reset",
            )
            is False
        )
    record = next(
        record
        for record in caplog.records
        if record.name == "app.email.service" and record.levelno == logging.ERROR
    )
    assert record.getMessage() == "email.error type=password_reset reason=provider_failure"
    assert record.exc_info is None
    assert "recipient@example.invalid" not in caplog.text
    assert "qa-auth-token" not in caplog.text
    assert "re_synthetic_test_only" not in caplog.text
    assert not sent_mail


def test_unrecognized_email_kind_never_becomes_log_content(sent_mail, monkeypatch, caplog):
    import resend

    monkeypatch.setattr(
        resend.Emails, "send", lambda _payload: (_ for _ in ()).throw(RuntimeError("private"))
    )
    with caplog.at_level(logging.ERROR, logger="app.email.service"):
        assert (
            service._send(
                to="recipient@example.invalid",
                subject="QA",
                html="<p>QA</p>",
                kind="qa-auth-token@example.invalid",
            )
            is False
        )
    assert "type=other" in caplog.text
    assert "qa-auth-token" not in caplog.text

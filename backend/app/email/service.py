import logging

import resend

from app.config import settings

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return bool(settings.resend_api_key)


def send_verification_email(*, to: str, token: str) -> None:
    if not _enabled():
        logger.info("email.skip reason=no_api_key to=%s type=verification", to)
        return
    verify_url = f"{settings.frontend_url}/verify-email?token={token}"
    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send({
            "from": settings.email_from,
            "to": to,
            "subject": "Verifica tu correo — Kova",
            "html": (
                "<p>Gracias por crear tu cuenta en Kova. Confirma tu correo para "
                "empezar a vender hoy mismo.</p>"
                f'<p><a href="{verify_url}">Verificar mi correo</a></p>'
                f"<p>O copia este enlace: {verify_url}</p>"
                "<p>El enlace expira en 24 horas.</p>"
            ),
        })
        logger.info("email.sent to=%s type=verification", to)
    except Exception:
        logger.exception("email.error to=%s type=verification", to)


def send_welcome_email(*, to: str) -> None:
    if not _enabled():
        logger.info("email.skip reason=no_api_key to=%s type=welcome", to)
        return
    dashboard_url = f"{settings.frontend_url}/dashboard"
    billing_url = f"{settings.frontend_url}/settings/billing"
    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send({
            "from": settings.email_from,
            "to": to,
            "subject": "Tu plan Kova está activo",
            "html": (
                "<p>¡Bienvenido a Kova! Tu plan está activo y ya puedes vender sin "
                "interrupciones.</p>"
                f'<p><a href="{dashboard_url}">Ir al panel</a></p>'
                "<p>Si necesitas ver tus datos de facturación o cambiar tu método de pago, "
                f'puedes hacerlo en <a href="{billing_url}">Configuración &gt; Facturación</a>.</p>'
                "<p>Gracias por confiar en Kova para tu negocio.</p>"
            ),
        })
        logger.info("email.sent to=%s type=welcome", to)
    except Exception:
        logger.exception("email.error to=%s type=welcome", to)


def send_password_reset_email(*, to: str, token: str) -> None:
    if not _enabled():
        logger.info("email.skip reason=no_api_key to=%s type=password_reset", to)
        return
    reset_url = f"{settings.frontend_url}/reset-password?token={token}"
    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send({
            "from": settings.email_from,
            "to": to,
            "subject": "Restablece tu contraseña — Kova",
            "html": (
                "<p>Recibimos una solicitud para restablecer tu contraseña en Kova.</p>"
                f'<p><a href="{reset_url}">Restablecer mi contraseña</a></p>'
                f"<p>O copia este enlace: {reset_url}</p>"
                "<p>El enlace expira en 1 hora. Si no fuiste tú, ignora este correo.</p>"
            ),
        })
        logger.info("email.sent to=%s type=password_reset", to)
    except Exception:
        logger.exception("email.error to=%s type=password_reset", to)

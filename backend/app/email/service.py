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
            "subject": "Verify your email — PoS",
            "html": (
                "<p>Thanks for signing up. Click the link below to verify your email "
                "and start using your PoS.</p>"
                f'<p><a href="{verify_url}">Verify my email</a></p>'
                f"<p>Or copy this link: {verify_url}</p>"
                "<p>This link expires in 24 hours.</p>"
            ),
        })
        logger.info("email.sent to=%s type=verification", to)
    except Exception:
        logger.exception("email.error to=%s type=verification", to)


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
            "subject": "Reset your password — PoS",
            "html": (
                "<p>We received a request to reset your password.</p>"
                f'<p><a href="{reset_url}">Reset my password</a></p>'
                f"<p>Or copy this link: {reset_url}</p>"
                "<p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>"
            ),
        })
        logger.info("email.sent to=%s type=password_reset", to)
    except Exception:
        logger.exception("email.error to=%s type=password_reset", to)

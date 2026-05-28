import logging

import resend

from app.config import settings
from app.email.templates import escape, kv_table, link, muted, p, render_email

logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return bool(settings.resend_api_key)


def _send(*, to: str, subject: str, html: str, kind: str) -> None:
    if not _enabled():
        logger.info("email.skip reason=no_api_key to=%s type=%s", to, kind)
        return
    resend.api_key = settings.resend_api_key
    try:
        resend.Emails.send({
            "from": settings.email_from,
            "to": to,
            "subject": subject,
            "html": html,
        })
        logger.info("email.sent to=%s type=%s", to, kind)
    except Exception:
        logger.exception("email.error to=%s type=%s", to, kind)


def send_verification_email(*, to: str, token: str) -> None:
    verify_url = f"{settings.frontend_url}/verify-email?token={token}"
    html = render_email(
        preheader="Confirma tu correo para empezar a vender con Kova.",
        heading="Verifica tu correo",
        intro_html=p(
            "Gracias por crear tu cuenta en Kova. Confirma tu correo para "
            "empezar a vender hoy mismo."
        ),
        cta_label="Verificar mi correo",
        cta_url=verify_url,
        body_html=(
            muted(
                f"O copia este enlace en tu navegador: "
                f'<span style="word-break: break-all;">{escape(verify_url)}</span>'
            )
            + muted("El enlace expira en 24 horas.")
        ),
    )
    _send(to=to, subject="Verifica tu correo — Kova", html=html, kind="verification")


def send_welcome_email(*, to: str) -> None:
    dashboard_url = f"{settings.frontend_url}/dashboard"
    billing_url = f"{settings.frontend_url}/settings/billing"
    html = render_email(
        preheader="Tu plan Kova está activo. Empieza a vender sin interrupciones.",
        heading="Tu plan Kova está activo",
        intro_html=(
            p("¡Bienvenido a Kova! Tu plan está activo y ya puedes vender sin interrupciones.")
            + p(
                "Desde tu panel podrás registrar ventas, controlar inventario y "
                "revisar reportes en tiempo real."
            )
        ),
        cta_label="Ir al panel",
        cta_url=dashboard_url,
        body_html=(
            muted(
                "Si necesitas ver tus datos de facturación o cambiar tu método de pago, "
                f"puedes hacerlo en {link('Configuración › Facturación', billing_url)}."
            )
            + muted("Gracias por confiar en Kova para tu negocio.")
        ),
    )
    _send(to=to, subject="Tu plan Kova está activo", html=html, kind="welcome")


def send_payment_receipt_email(
    *,
    to: str,
    amount_minor_units: int,
    currency: str,
    invoice_number: str | None = None,
    invoice_url: str | None = None,
    period_end_iso: str | None = None,
) -> None:
    billing_url = f"{settings.frontend_url}/settings/billing"
    amount_str = f"${amount_minor_units / 100:,.2f} {currency.upper()}"
    rows: list[tuple[str, str]] = [("Monto", escape(amount_str))]
    if invoice_number:
        rows.append(("Folio", escape(invoice_number)))
    if period_end_iso:
        rows.append(("Próximo cargo", escape(period_end_iso)))

    body = kv_table(rows)
    body += muted(
        f"Detalles de tu suscripción en {link('Configuración › Facturación', billing_url)}."
    )
    html = render_email(
        preheader=f"Confirmamos el pago de {amount_str} a tu suscripción Kova.",
        heading="Recibo de pago",
        intro_html=p("Confirmamos el pago de tu suscripción a Kova. Tu plan continúa activo."),
        cta_label="Ver recibo en Stripe" if invoice_url else None,
        cta_url=invoice_url if invoice_url else None,
        body_html=body,
    )
    _send(to=to, subject="Recibo de pago — Kova", html=html, kind="payment_receipt")


def send_trial_ending_email(*, to: str, trial_ends_iso: str) -> None:
    billing_url = f"{settings.frontend_url}/settings/billing"
    html = render_email(
        preheader=(
            f"Tu prueba gratis termina el {trial_ends_iso}. "
            "Activa tu plan para seguir vendiendo."
        ),
        heading="Tu prueba termina pronto",
        intro_html=(
            p("Tu periodo de prueba en Kova termina pronto.")
            + p(f"Fecha de término: <strong>{escape(trial_ends_iso)}</strong>")
            + p(
                "Para no perder acceso a tu panel, ventas e inventario, activa tu plan "
                "antes de esa fecha."
            )
        ),
        cta_label="Activar mi plan",
        cta_url=billing_url,
        body_html=muted("Si ya activaste tu plan, ignora este mensaje."),
    )
    _send(
        to=to,
        subject="Tu periodo de prueba de Kova termina pronto",
        html=html,
        kind="trial_ending",
    )


_ROLE_LABELS = {
    "owner": "Propietario",
    "manager": "Gerente",
    "cashier": "Cajero",
}


def send_invitation_email(
    *,
    to: str,
    token: str,
    tenant_name: str,
    role: str,
    invited_by_email: str | None = None,
) -> None:
    accept_url = f"{settings.frontend_url}/accept-invite?token={token}"
    role_label = _ROLE_LABELS.get(role, role)
    intro = p(
        f"Te invitaron a unirte a <strong>{escape(tenant_name)}</strong> en Kova "
        f"como <strong>{escape(role_label)}</strong>."
    )
    if invited_by_email:
        intro += muted(f"Invitación enviada por {escape(invited_by_email)}.")
    html = render_email(
        preheader=f"Únete a {tenant_name} en Kova como {role_label}.",
        heading="Te invitaron a Kova",
        intro_html=intro,
        cta_label="Aceptar invitación",
        cta_url=accept_url,
        body_html=(
            muted(
                "O copia este enlace en tu navegador: "
                f'<span style="word-break: break-all;">{escape(accept_url)}</span>'
            )
            + muted("El enlace expira en 7 días.")
        ),
    )
    _send(
        to=to,
        subject=f"Te invitaron a {tenant_name} en Kova",
        html=html,
        kind="invitation",
    )


def send_password_reset_email(*, to: str, token: str) -> None:
    reset_url = f"{settings.frontend_url}/reset-password?token={token}"
    html = render_email(
        preheader="Restablece tu contraseña de Kova.",
        heading="Restablece tu contraseña",
        intro_html=p("Recibimos una solicitud para restablecer tu contraseña en Kova."),
        cta_label="Restablecer mi contraseña",
        cta_url=reset_url,
        body_html=(
            muted(
                f"O copia este enlace en tu navegador: "
                f'<span style="word-break: break-all;">{escape(reset_url)}</span>'
            )
            + muted("El enlace expira en 1 hora. Si no fuiste tú, ignora este correo.")
        ),
    )
    _send(to=to, subject="Restablece tu contraseña — Kova", html=html, kind="password_reset")

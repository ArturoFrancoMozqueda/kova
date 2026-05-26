"""Shared HTML wrapper for Kova lifecycle emails.

Uses table-based layout + inline CSS for Gmail/Outlook compatibility.
The Kova mark is rendered as inline SVG (best-effort: Apple Mail,
Outlook desktop, most webmail render it; Gmail strips it and falls
back to the text wordmark, which is intentional).
"""

from __future__ import annotations

from html import escape

# Brand tokens duplicated here (inline CSS — email clients ignore
# external stylesheets and CSS variables).
KOVA_BLUE = "#4F7EF7"
KOVA_INK = "#0F1117"
KOVA_MIST = "#F5F6FA"
KOVA_MUTED = "#6B7A99"
KOVA_TERTIARY = "#8892A4"
KOVA_BORDER = "#E2E6EF"

FONT_STACK = (
    "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "'Helvetica Neue', Arial, sans-serif"
)

# Logo (isotipo) — same node geometry as frontend/src/components/brand/Logo.tsx.
# Inline SVG renders in Apple Mail/Outlook desktop/most webmail; Gmail
# strips SVG, so we also show the "kova" wordmark next to it.
_LOGO_SVG = f"""
<svg width="40" height="40" viewBox="0 0 64 64" fill="none"
  xmlns="http://www.w3.org/2000/svg" role="img" aria-label="kova">
  <path d="M 32 8 A 52 52 0 0 1 52.78 44" stroke="{KOVA_INK}"
    stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M 52.78 44 A 52 52 0 0 1 11.22 44" stroke="{KOVA_INK}"
    stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M 11.22 44 A 52 52 0 0 1 32 8" stroke="{KOVA_INK}"
    stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="32" cy="8" r="5" fill="{KOVA_INK}"/>
  <circle cx="52.78" cy="44" r="5" fill="{KOVA_INK}"/>
  <circle cx="11.22" cy="44" r="5" fill="{KOVA_INK}"/>
  <circle cx="32" cy="32" r="5" fill="{KOVA_BLUE}"/>
</svg>
""".strip()


def _button(label: str, url: str) -> str:
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin: 24px 0;"><tr><td align="left" '
        f'style="border-radius: 8px; background-color: {KOVA_INK};">'
        f'<a href="{escape(url, quote=True)}" target="_blank" '
        f'style="display: inline-block; padding: 12px 20px; font-family: {FONT_STACK}; '
        f'font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; '
        f'border-radius: 8px; letter-spacing: -0.01em;">'
        f"{escape(label)}</a></td></tr></table>"
    )


def render_email(
    *,
    preheader: str,
    heading: str,
    intro_html: str,
    cta_label: str | None = None,
    cta_url: str | None = None,
    body_html: str = "",
    footer_html: str | None = None,
) -> str:
    """Render a Kova-branded HTML email.

    ``intro_html`` and ``body_html`` should already be HTML (caller is
    responsible for escaping any untrusted values inside them).
    ``heading``, ``preheader``, ``cta_label`` are escaped here.
    """
    cta = _button(cta_label, cta_url) if cta_label and cta_url else ""
    footer = footer_html or (
        f'<p style="margin: 0 0 4px 0; font-family: {FONT_STACK}; font-size: 12px; '
        f'color: {KOVA_TERTIARY}; line-height: 1.5;">'
        "Recibes este correo porque tienes una cuenta activa en Kova."
        "</p>"
        f'<p style="margin: 0; font-family: {FONT_STACK}; font-size: 12px; '
        f'color: {KOVA_TERTIARY}; line-height: 1.5;">'
        "Kova · Tu negocio, en flujo constante."
        "</p>"
    )

    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>{escape(heading)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: {KOVA_MIST}; \
font-family: {FONT_STACK}; color: {KOVA_INK};">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; \
color: transparent; visibility: hidden;">{escape(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
style="background-color: {KOVA_MIST};">
  <tr>
    <td align="center" style="padding: 32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" \
style="max-width: 600px; width: 100%; background-color: #ffffff; \
border: 1px solid {KOVA_BORDER}; border-radius: 14px; overflow: hidden;">
        <!-- Header -->
        <tr>
          <td style="padding: 24px 32px; border-bottom: 1px solid {KOVA_BORDER};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align: middle; padding-right: 12px;">{_LOGO_SVG}</td>
                <td style="vertical-align: middle; font-family: {FONT_STACK}; \
font-size: 22px; font-weight: 600; color: {KOVA_INK}; letter-spacing: -0.02em;">kova</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding: 32px;">
            <h1 style="margin: 0 0 16px 0; font-family: {FONT_STACK}; font-size: 24px; \
font-weight: 600; color: {KOVA_INK}; line-height: 1.3; letter-spacing: -0.5px;">\
{escape(heading)}</h1>
            <div style="font-family: {FONT_STACK}; font-size: 15px; line-height: 1.6; \
color: {KOVA_INK};">{intro_html}</div>
            {cta}
            {body_html}
          </td>
        </tr>
        <!-- Brand accent line -->
        <tr>
          <td style="height: 4px; background: linear-gradient(90deg, {KOVA_BLUE} 0%, \
#7BA7FF 100%); font-size: 0; line-height: 0;">&nbsp;</td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding: 24px 32px; background-color: {KOVA_MIST};">
            {footer}
          </td>
        </tr>
      </table>
      <p style="margin: 16px 0 0 0; font-family: {FONT_STACK}; font-size: 11px; \
color: {KOVA_TERTIARY};">© Kova · POS para tu negocio</p>
    </td>
  </tr>
</table>
</body>
</html>"""


def p(text_or_html: str) -> str:
    """Helper for callers: build a body paragraph with brand styling."""
    return (
        f'<p style="margin: 0 0 12px 0; font-family: {FONT_STACK}; font-size: 15px; '
        f'line-height: 1.6; color: {KOVA_INK};">{text_or_html}</p>'
    )


def muted(text_or_html: str) -> str:
    return (
        f'<p style="margin: 0 0 12px 0; font-family: {FONT_STACK}; font-size: 13px; '
        f'line-height: 1.5; color: {KOVA_MUTED};">{text_or_html}</p>'
    )


def kv_row(label: str, value: str) -> str:
    return (
        f'<tr><td style="padding: 8px 0; font-family: {FONT_STACK}; font-size: 13px; '
        f'color: {KOVA_MUTED}; width: 40%;">{escape(label)}</td>'
        f'<td style="padding: 8px 0; font-family: {FONT_STACK}; font-size: 14px; '
        f'color: {KOVA_INK}; font-weight: 500;">{value}</td></tr>'
    )


def kv_table(rows: list[tuple[str, str]]) -> str:
    body = "".join(kv_row(k, v) for k, v in rows)
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%" style="margin: 16px 0; border-top: 1px solid {KOVA_BORDER}; '
        f'border-bottom: 1px solid {KOVA_BORDER};">{body}</table>'
    )


def link(label: str, url: str) -> str:
    return (
        f'<a href="{escape(url, quote=True)}" '
        f'style="color: {KOVA_BLUE}; text-decoration: underline;">{escape(label)}</a>'
    )

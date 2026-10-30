"""Shared HTML wrapper for Kova lifecycle emails.

Uses table-based layout + inline CSS for Gmail/Outlook compatibility.
The Kova mark is a public PNG because Gmail strips inline SVG from
message bodies.
"""

from __future__ import annotations

from html import escape
from html.parser import HTMLParser

# Brand tokens duplicated here (inline CSS — email clients ignore
# external stylesheets and CSS variables).
KOVA_BLUE = "#3563D0"
KOVA_INK = "#0F1117"
KOVA_MIST = "#F5F6FA"
KOVA_MUTED = "#61728C"
KOVA_TERTIARY = "#667185"
KOVA_BORDER = "#E2E6EF"

FONT_STACK = (
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "'Helvetica Neue', Arial, sans-serif"
)

# Same isotipo as frontend/src/components/brand/Logo.tsx. Keep the URL on the
# canonical production origin so Gmail can proxy and cache it reliably.
KOVA_LOGO_URL = "https://kovasuite.com/email/kova-mark.png"
# Same controlled-beta support address as frontend/src/lib/support.ts.
SUPPORT_EMAIL = "posprojectsupport@gmail.com"


class _PlainTextEmail(HTMLParser):
    """Extract readable text from our rendered HTML, preserving actionable links."""

    _VOID = {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
    _BLOCK = {"div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "table", "tr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored_depth = 0
        self.links: list[tuple[str, int]] = []

    def handle_starttag(self, tag, attrs):
        if self.ignored_depth:
            if tag not in self._VOID:
                self.ignored_depth += 1
            return
        attributes = dict(attrs)
        style = "".join((attributes.get("style") or "").lower().split())
        if (
            tag in {"head", "script", "style"}
            or "hidden" in attributes
            or attributes.get("aria-hidden") == "true"
            or "display:none" in style
            or "visibility:hidden" in style
        ):
            if tag not in self._VOID:
                self.ignored_depth = 1
            return
        if tag in self._BLOCK or tag in {"br", "hr"}:
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("• ")
        if tag in {"td", "th"} and self.parts and self.parts[-1].strip():
            self.parts.append(" | ")
        if tag == "a":
            self.links.append((attributes.get("href") or "", len(self.parts)))

    def handle_endtag(self, tag):
        if self.ignored_depth:
            if tag not in self._VOID:
                self.ignored_depth -= 1
            return
        if tag == "a" and self.links:
            href, start = self.links.pop()
            label = "".join(self.parts[start:]).strip()
            if href.startswith(("https://", "http://", "mailto:")) and href != label:
                self.parts.append(f" ({href})")
        if tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.ignored_depth:
            self.parts.append(data)


def plain_text_email(html: str) -> str:
    parser = _PlainTextEmail()
    parser.feed(html)
    parser.close()
    lines: list[str] = []
    for raw_line in "".join(parser.parts).splitlines():
        line = " ".join(raw_line.split())
        if line or (lines and lines[-1]):
            lines.append(line)
    return "\n".join(lines).strip()


def _button(label: str, url: str) -> str:
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'class="kova-action" style="margin: 28px 0;"><tr><td align="center" '
        f'bgcolor="{KOVA_INK}" style="border-radius: 6px; background-color: {KOVA_INK}; '
        f'mso-padding-alt: 15px 24px;">'
        f'<a href="{escape(url, quote=True)}" target="_blank" '
        f'style="display: inline-block; padding: 15px 24px; font-family: {FONT_STACK}; '
        f"font-size: 15px; line-height: 20px; font-weight: 600; color: #ffffff; "
        f"text-decoration: none; "
        f'border: 1px solid {KOVA_INK}; border-radius: 6px; letter-spacing: -0.01em; '
        f'mso-padding-alt: 0;">'
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
    eyebrow: str = "Tu cuenta Kova",
    detail_html: str = "",
) -> str:
    """Render a Kova-branded HTML email.

    ``intro_html`` and ``body_html`` should already be HTML (caller is
    responsible for escaping any untrusted values inside them).
    ``heading``, ``preheader``, ``cta_label`` and ``eyebrow`` are escaped here.
    ``detail_html`` is trusted markup placed before the primary action.
    """
    cta = _button(cta_label, cta_url) if cta_label and cta_url else ""
    footer = footer_html or muted("Kova · Tu negocio, en flujo constante.")

    return f"""<!doctype html>
<html lang="es-MX" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>{escape(heading)}</title>
<style>
  body, table, td, a {{ -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }}
  table, td {{ mso-table-lspace: 0; mso-table-rspace: 0; }}
  @media only screen and (max-width: 600px) {{
    .kova-shell {{ padding: 32px 24px !important; }}
    .kova-heading {{ font-size: 26px !important; line-height: 34px !important; }}
    .kova-action {{ width: 100% !important; }}
    .kova-action a {{ display: block !important; padding-left: 12px !important;
      padding-right: 12px !important; }}
  }}
</style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: {FONT_STACK}; \
color: {KOVA_INK};">
<div lang="es-MX" dir="ltr">
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; \
color: transparent; visibility: hidden;">{escape(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" \
style="background-color: #ffffff;">
<tr><td align="center" class="kova-shell" style="padding: 56px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" \
style="width: 100%; max-width: 520px;">
  <tr><td style="padding-bottom: 44px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right: 12px; vertical-align: middle;">
        <img src="{KOVA_LOGO_URL}" width="40" height="40" alt="" \
style="display: block; width: 40px; height: 40px; border: 0; outline: none;">
      </td>
      <td style="font-family: {FONT_STACK}; font-size: 25px; line-height: 32px; \
font-weight: 700; color: {KOVA_INK}; letter-spacing: -0.8px;">kova</td>
    </tr></table>
  </td></tr>
  <tr><td style="overflow-wrap: anywhere; word-wrap: break-word;">
    <p style="margin: 0 0 12px; font-family: {FONT_STACK}; font-size: 13px; \
line-height: 20px; color: {KOVA_MUTED};">{escape(eyebrow)}</p>
    <h1 class="kova-heading" style="margin: 0 0 24px; font-family: {FONT_STACK}; \
font-size: 30px; line-height: 38px; font-weight: 600; color: {KOVA_INK}; \
letter-spacing: -0.6px;">{escape(heading)}</h1>
    <div style="font-family: {FONT_STACK}; font-size: 16px; line-height: 26px; \
color: {KOVA_INK};">{intro_html}</div>
    {detail_html}
    {cta}
    {body_html}
  </td></tr>
  <tr><td style="padding-top: 36px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td style="border-top: 1px solid {KOVA_BORDER}; padding-top: 24px;">
      <p style="margin: 0 0 12px; font-family: {FONT_STACK}; font-size: 13px; \
line-height: 21px; color: {KOVA_MUTED};">¿Necesitas ayuda? \
{link('Contactar soporte', f'mailto:{SUPPORT_EMAIL}')}</p>
      {footer}
    </td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</div>
</body>
</html>"""


def p(text_or_html: str) -> str:
    """Helper for callers: build a body paragraph with brand styling."""
    return (
        f'<p style="margin: 0 0 14px; font-family: {FONT_STACK}; font-size: 16px; '
        f'line-height: 26px; color: {KOVA_INK};">{text_or_html}</p>'
    )


def muted(text_or_html: str) -> str:
    return (
        f'<p style="margin: 0 0 12px 0; font-family: {FONT_STACK}; font-size: 13px; '
        f'line-height: 1.5; color: {KOVA_MUTED};">{text_or_html}</p>'
    )


def kv_row(label: str, value: str) -> str:
    return (
        f'<tr><td style="padding: 10px 0; font-family: {FONT_STACK}; font-size: 13px; '
        f'color: {KOVA_MUTED}; width: 40%;">{escape(label)}</td>'
        f'<td align="right" style="padding: 10px 0 10px 16px; font-family: {FONT_STACK}; '
        f'font-size: 15px; color: {KOVA_INK}; font-weight: 600; overflow-wrap: anywhere; '
        f'word-wrap: break-word;">{value}</td></tr>'
    )


def kv_table(rows: list[tuple[str, str]]) -> str:
    body = "".join(kv_row(k, v) for k, v in rows)
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%" style="margin: 28px 0; border-top: 1px solid {KOVA_BORDER}; '
        f'border-bottom: 1px solid {KOVA_BORDER};"><tr><td style="padding: 4px 0;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%" style="table-layout: fixed;">{body}</table>'
        f'</td></tr></table>'
    )


def fallback_link(url: str, label: str = "abre este enlace alternativo") -> str:
    """A discreet alternative link; plain text still includes the full URL."""
    return muted(
        "Si el botón no funciona, "
        + link(label, url)
        + "."
    )


def link(label: str, url: str) -> str:
    return (
        f'<a href="{escape(url, quote=True)}" '
        f'style="color: {KOVA_BLUE}; text-decoration: underline;">{escape(label)}</a>'
    )

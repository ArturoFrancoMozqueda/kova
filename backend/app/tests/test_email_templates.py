from html.parser import HTMLParser

import pytest

from app.email.templates import (
    KOVA_BLUE,
    KOVA_LOGO_URL,
    KOVA_MIST,
    KOVA_MUTED,
    KOVA_TERTIARY,
    fallback_link,
    kv_table,
    p,
    plain_text_email,
    render_email,
)


def test_render_email_uses_gmail_compatible_public_logo() -> None:
    html = render_email(
        preheader="Prueba",
        heading="Prueba de correo",
        intro_html=p("Contenido"),
    )

    assert KOVA_LOGO_URL == "https://kovasuite.com/email/kova-mark.png"
    assert f'src="{KOVA_LOGO_URL}"' in html
    assert 'width="40" height="40"' in html
    assert "<svg" not in html


def test_plain_text_preserves_unicode_and_links_without_styles_or_hidden_preheader():
    html = render_email(
        preheader="Preencabezado oculto",
        heading="¡Hola, José!",
        intro_html=p("Café &amp; pan: $1,234.50 MXN."),
        cta_label="Consultar mi suscripción",
        cta_url="https://qa.kova.invalid/acción?dato=piñata&lang=es-MX",
    )
    text = plain_text_email(html)
    assert "¡Hola, José!" in text
    assert "Café & pan: $1,234.50 MXN." in text
    assert (
        "Consultar mi suscripción (https://qa.kova.invalid/acción?dato=piñata&lang=es-MX)" in text
    )
    assert "Preencabezado oculto" not in text
    assert "font-family" not in text
    assert "<table" not in text and "<h1" not in text
    assert '<html lang="es-MX" dir="ltr">' in html
    assert '<div lang="es-MX" dir="ltr">' in html


def test_plain_text_ignores_hidden_nested_content_and_handles_rows_and_breaks():
    text = plain_text_email(
        "<html><head><style>secret-style</style></head><body>"
        "<div hidden><p>hidden-note<br>more</p></div><script>secret-script</script>"
        "<table><tr><td>Monto</td><td>$299.00 MXN</td></tr>"
        "<tr><td>Folio</td><td>QA-ÁRBOL</td></tr></table>"
        "<p>Primero<br>Segundo &amp; tercero</p></body></html>"
    )
    assert "Monto | $299.00 MXN" in text
    assert "Folio | QA-ÁRBOL" in text
    assert "Primero\nSegundo & tercero" in text
    assert "hidden-note" not in text and "secret-" not in text


def test_summary_precedes_primary_action_and_untrusted_labels_stay_text():
    html = render_email(
        preheader="Resumen",
        heading="Recibo",
        eyebrow='<script>alert("label")</script>',
        intro_html=p("Pago confirmado"),
        detail_html=kv_table([("Monto", "$299.00 MXN")]),
        cta_label="Ver recibo",
        cta_url='https://qa.kova.invalid/receipt?one=1&two="2"',
    )
    assert html.index("$299.00 MXN") < html.index("Ver recibo</a>")
    assert "&lt;script&gt;" in html and "<script>" not in html
    assert 'href="https://qa.kova.invalid/receipt?one=1&amp;two=&quot;2&quot;"' in html


def test_long_fallback_capability_url_remains_actionable_in_html_and_plain_text():
    url = 'https://qa.kova.invalid/reset-password?token=' + "a"*128 + '&note=<qa>'
    html = fallback_link(url)
    assert url in plain_text_email(html)
    assert "&lt;qa&gt;" in html and "<qa>" not in html
    assert 'href="https://qa.kova.invalid/reset-password?token=' in html
    assert "abre este enlace alternativo" in html


class _EmailStructure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.headings = 0
        self.layout_tables = []
        self.image_alts = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "h1":
            self.headings += 1
        if tag == "table":
            self.layout_tables.append(attributes.get("role"))
        if tag == "img":
            self.image_alts.append(attributes.get("alt"))


def test_presentation_keeps_semantic_heading_decorative_logo_and_table_roles():
    html = render_email(preheader="Prueba", heading="Tu cuenta", intro_html=p("Hola"))
    structure = _EmailStructure()
    structure.feed(html)
    assert structure.headings == 1
    assert structure.layout_tables and set(structure.layout_tables) == {"presentation"}
    assert structure.image_alts == [""]
    assert 'href="mailto:' in html


def _luminance(hex_color):
    channels = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [
        value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
        for value in channels
    ]
    return sum(
        value * weight for value, weight in zip(linear, [0.2126, 0.7152, 0.0722], strict=True)
    )


@pytest.mark.parametrize("foreground", [KOVA_BLUE, KOVA_MUTED, KOVA_TERTIARY])
@pytest.mark.parametrize("background", ["#FFFFFF", KOVA_MIST])
def test_small_email_text_has_wcag_aa_contrast(foreground, background):
    lighter, darker = sorted([_luminance(foreground), _luminance(background)], reverse=True)
    assert (lighter + 0.05) / (darker + 0.05) >= 4.5

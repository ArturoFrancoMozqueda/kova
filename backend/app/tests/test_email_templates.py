from app.email.templates import KOVA_LOGO_URL, p, render_email


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

import { useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "@/components/brand/Logo";

type LegalPageProps = {
  variant: "privacy" | "terms";
};

const lastUpdated = "21 de mayo de 2026";

const content: Record<LegalPageProps["variant"], { title: string; intro: string; sections: { heading: string; body: string[] }[] }> = {
  privacy: {
    title: "Aviso de privacidad",
    intro:
      "Kova respeta tus datos. Este aviso describe qué información recolectamos, para qué la usamos y cómo puedes ejercer tus derechos como titular conforme a la LFPDPPP (México).",
    sections: [
      {
        heading: "Responsable del tratamiento",
        body: [
          "El responsable del tratamiento de tus datos personales es el equipo de Kova. Puedes contactarnos en posprojectsupport@gmail.com para cualquier asunto relacionado con tus datos.",
        ],
      },
      {
        heading: "Datos que recolectamos",
        body: [
          "Datos de cuenta: nombre del negocio, correo electrónico, contraseña (almacenada con hash).",
          "Datos operativos: productos, ventas, inventario, turnos y reportes que registras en el POS.",
          "Datos de facturación: gestionados por nuestro procesador Stripe; Kova no almacena tarjetas.",
          "Datos técnicos: dirección IP, navegador, eventos de uso anónimos para mejorar el producto.",
        ],
      },
      {
        heading: "Finalidades",
        body: [
          "Operar tu cuenta y mantener tu información aislada por inquilino (multi-tenant).",
          "Procesar tu suscripción y cobros recurrentes a través de Stripe.",
          "Enviar correos transaccionales (verificación, facturación, recuperación de cuenta).",
          "Mejorar el producto con base en métricas agregadas y anónimas.",
        ],
      },
      {
        heading: "Conservación",
        body: [
          "Conservamos tus datos mientras tu cuenta esté activa. Si cancelas, conservamos los datos fiscales obligatorios por el tiempo que exija la ley y eliminamos el resto en un plazo razonable.",
        ],
      },
      {
        heading: "Tus derechos ARCO",
        body: [
          "Puedes solicitar acceso, rectificación, cancelación u oposición al tratamiento de tus datos enviando un correo a posprojectsupport@gmail.com con el asunto 'Privacidad Kova'. Responderemos en un plazo máximo de 20 días hábiles.",
        ],
      },
      {
        heading: "Terceros",
        body: [
          "Compartimos datos únicamente con proveedores necesarios para operar el servicio: Stripe (pagos), Supabase / PostgreSQL (almacenamiento), Fly.io y Vercel (hospedaje), Sentry (errores). Todos están bajo cláusulas de confidencialidad.",
        ],
      },
      {
        heading: "Cambios",
        body: [
          "Si modificamos este aviso te notificaremos por correo. La versión vigente siempre estará disponible en /privacy.",
        ],
      },
    ],
  },
  terms: {
    title: "Términos y condiciones",
    intro:
      "Estos términos rigen el uso de Kova. Al crear una cuenta los aceptas. Si no estás de acuerdo, no uses el servicio.",
    sections: [
      {
        heading: "El servicio",
        body: [
          "Kova es un punto de venta multi-tenant en la nube para PyMEs en México. Operamos en modo beta privada: priorizamos estabilidad sobre cantidad de funciones nuevas.",
        ],
      },
      {
        heading: "Cuenta y responsabilidades",
        body: [
          "Eres responsable de la veracidad de la información de tu negocio, de tu contraseña y de la actividad en tu cuenta.",
          "No puedes usar Kova para actividades ilícitas, fraudulentas o que violen derechos de terceros.",
          "Cada cuenta es para un negocio. Para operar varios negocios contacta a soporte.",
        ],
      },
      {
        heading: "Suscripción y pagos",
        body: [
          "Kova ofrece un Plan Estándar de $299 MXN/mes con prueba inicial sin tarjeta. Al activar la suscripción aceptas el cargo recurrente mensual procesado por Stripe.",
          "Puedes cancelar en cualquier momento desde /settings/billing. La cancelación detiene cargos futuros; no se prorratean periodos en curso.",
        ],
      },
      {
        heading: "Disponibilidad",
        body: [
          "Trabajamos para mantener el servicio operativo, pero no garantizamos disponibilidad ininterrumpida. Kova incluye modo offline para venta en mostrador cuando no hay conexión.",
        ],
      },
      {
        heading: "Datos del comercio",
        body: [
          "Tus datos son tuyos. Puedes exportar tu información comercial en cualquier momento solicitándolo a soporte. Detallamos el manejo de datos personales en el Aviso de privacidad.",
        ],
      },
      {
        heading: "Limitación de responsabilidad",
        body: [
          "Kova se ofrece 'tal cual'. En la medida permitida por ley, nuestra responsabilidad se limita al monto pagado por el comercio en los 3 meses previos al evento que dé lugar al reclamo.",
        ],
      },
      {
        heading: "Ley aplicable",
        body: [
          "Estos términos se rigen por las leyes de México. Cualquier controversia se resolverá en tribunales competentes de Ciudad de México, salvo que la ley imponga otra jurisdicción.",
        ],
      },
      {
        heading: "Contacto",
        body: [
          "Para dudas o reclamos: posprojectsupport@gmail.com.",
        ],
      },
    ],
  },
};

export default function LegalPage({ variant }: LegalPageProps) {
  const data = content[variant];

  // Match body bg to legal-page bg so wide viewports don't show a seam.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    const legalBg = "#FBFBFD";
    html.style.background = legalBg;
    body.style.background = legalBg;
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--kova-paper, #FBFBFD)",
        color: "var(--kova-ink)",
        fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <header
        style={{
          padding: "24px 32px",
          borderBottom: "0.5px solid var(--kova-border)",
        }}
      >
        <Link to="/" style={{ display: "inline-flex", color: "var(--kova-ink)" }} aria-label="kova">
          <Logo size={24} circuitColor="currentColor" wordmarkColor="currentColor" coreColor="var(--kova-blue)" />
        </Link>
      </header>

      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "64px 24px 96px",
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--kova-tertiary)",
          }}
        >
          Legal
        </p>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: "-0.8px",
            marginTop: 8,
            lineHeight: 1.15,
          }}
        >
          {data.title}
        </h1>
        <p style={{ fontSize: 13, color: "var(--kova-tertiary)", marginTop: 8 }}>
          Última actualización: {lastUpdated}
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--kova-muted)", marginTop: 24 }}>
          {data.intro}
        </p>

        <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 32 }}>
          {data.sections.map((section) => (
            <section key={section.heading}>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  letterSpacing: "-0.3px",
                  color: "var(--kova-ink)",
                }}
              >
                {section.heading}
              </h2>
              {section.body.map((paragraph, idx) => (
                <p
                  key={idx}
                  style={{
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "var(--kova-muted)",
                    marginTop: 12,
                  }}
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <footer style={{ marginTop: 64, paddingTop: 24, borderTop: "0.5px solid var(--kova-border)", display: "flex", gap: 16, fontSize: 13 }}>
          <Link to="/privacy" style={{ color: "var(--kova-muted)" }}>
            Aviso de privacidad
          </Link>
          <Link to="/terms" style={{ color: "var(--kova-muted)" }}>
            Términos y condiciones
          </Link>
          <Link to="/" style={{ color: "var(--kova-muted)", marginLeft: "auto" }}>
            ← Volver al inicio
          </Link>
        </footer>
      </article>
    </main>
  );
}

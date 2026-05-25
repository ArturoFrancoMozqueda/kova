import { useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "@/components/brand/Logo";

type LegalPageProps = {
  variant: "privacy" | "terms" | "security";
};

const lastUpdated = "25 de mayo de 2026";

type SectionContent = {
  heading: string;
  body: string[];
};

type VariantContent = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: SectionContent[];
};

const content: Record<LegalPageProps["variant"], VariantContent> = {
  privacy: {
    eyebrow: "Legal",
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
    eyebrow: "Legal",
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
  security: {
    eyebrow: "Seguridad",
    title: "Cómo protegemos tu negocio",
    intro:
      "Kova maneja la operación de tu PyME: ventas, inventario, turnos, y datos de tus clientes. Esta página explica con honestidad cómo cuidamos esa información durante la beta y qué puedes esperar de nosotros.",
    sections: [
      {
        heading: "Aislamiento por inquilino",
        body: [
          "Cada negocio (tenant) en Kova vive en un espacio lógico aislado. Aplicamos dos capas de aislamiento que se refuerzan entre sí:",
          "Capa de aplicación: cada petición a la API valida tu sesión, identifica tu tenant y pasa ese identificador explícitamente a la base de datos para filtrar resultados.",
          "Capa de base de datos: PostgreSQL aplica políticas Row-Level Security (RLS) en todas las tablas con datos comerciales. Incluso si la capa de aplicación tuviera un bug, RLS impide que una consulta sin tenant_id devuelva renglones de otro negocio.",
        ],
      },
      {
        heading: "Sesiones y cookies",
        body: [
          "Tu sesión vive en cookies HttpOnly (no accesibles por JavaScript), marcadas Secure (solo HTTPS) y SameSite=Lax (no se envían en navegaciones cross-site).",
          "Tokens: access token de 15 minutos (JWT firmado HS256) y refresh token opaco de 30 días almacenado como SHA-256 en la base. No usamos localStorage para credenciales.",
          "Protección CSRF: las peticiones de escritura llevan un token de doble verificación (cookie csrf_token + header X-CSRF-Token) que el servidor compara en tiempo constante. Los webhooks de Stripe se validan por firma; no por cookie.",
          "Contraseñas: se almacenan con hash bcrypt; nunca en texto plano.",
        ],
      },
      {
        heading: "Respaldos y recuperación",
        body: [
          "Tomamos respaldos completos diarios de la base de datos (pg_dump) y los subimos a Cloudflare R2 con retención de 7 días.",
          "El workflow se ejecuta automáticamente cada noche y se verifica al terminar. Si una corrida falla, recibimos alerta.",
          "Practicamos restauración: documentamos el procedimiento en docs/runbooks/restore-supabase-backup.md y lo ejercitamos antes de habilitar billing en vivo.",
        ],
      },
      {
        heading: "Monitoreo de disponibilidad",
        body: [
          "Monitoreamos tres puntos críticos con UptimeRobot: el frontend (kovasuite.com), la API (api.kovasuite.com/health) y la API + base (api.kovasuite.com/health/db).",
          "Si alguno cae, recibimos alerta inmediata. Reportes públicos y SLA formal son parte del trabajo posterior a la beta inicial.",
        ],
      },
      {
        heading: "Separación de pagos",
        body: [
          "Kova no procesa los pagos que tus clientes hacen en tu mostrador. Esos cobros (efectivo, transferencia, tarjeta manual) se registran en el POS, pero el dinero nunca pasa por Kova.",
          "Lo único que cobra Kova es tu suscripción mensual al SaaS, y ese cargo lo procesa Stripe directamente. Kova nunca recibe ni almacena los datos de tu tarjeta: Stripe los tokeniza.",
        ],
      },
      {
        heading: "Lo que esperamos de ti",
        body: [
          "Usa contraseñas largas (12+ caracteres) y únicas. Si compartes acceso con tu equipo, dales su propio usuario en Configuración → Empleados con el rol mínimo necesario.",
          "Cierra sesión al terminar el turno en equipos compartidos. La sesión expira sola, pero el cierre explícito es más rápido.",
          "Avísanos de cualquier comportamiento extraño en posprojectsupport@gmail.com con el asunto 'Seguridad Kova'.",
        ],
      },
      {
        heading: "Qué esperar como tenant en beta",
        body: [
          "Estamos en beta privada controlada. Esto significa: estabilidad sobre cantidad de funciones, despliegues frecuentes con pruebas, contacto directo con el equipo y compromiso de comunicar cualquier incidente que afecte tu operación.",
          "No garantizamos disponibilidad ininterrumpida durante la beta. Kova incluye modo offline para que la caja siga funcionando si la red falla.",
          "Si descubres una vulnerabilidad, escríbenos antes de divulgarla públicamente. Coordinaremos un parche y te reconoceremos el reporte.",
        ],
      },
      {
        heading: "Soporte",
        body: [
          "Canal único durante beta: posprojectsupport@gmail.com. Respondemos en horario hábil de México (lun-vie, 9:00 a 19:00 CDMX). Incidentes que rompan tu operación se atienden con prioridad alta.",
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
          {data.eyebrow}
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

        <footer
          style={{
            marginTop: 64,
            paddingTop: 24,
            borderTop: "0.5px solid var(--kova-border)",
            display: "flex",
            gap: 16,
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          <Link to="/privacy" style={{ color: "var(--kova-muted)" }}>
            Aviso de privacidad
          </Link>
          <Link to="/terms" style={{ color: "var(--kova-muted)" }}>
            Términos y condiciones
          </Link>
          <Link to="/seguridad" style={{ color: "var(--kova-muted)" }}>
            Seguridad
          </Link>
          <Link to="/" style={{ color: "var(--kova-muted)", marginLeft: "auto" }}>
            ← Volver al inicio
          </Link>
        </footer>
      </article>
    </main>
  );
}

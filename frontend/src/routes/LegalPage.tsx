import { useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "@/components/brand/Logo";

type LegalPageProps = {
  variant: "privacy" | "terms" | "security";
};

type SectionContent = {
  heading: string;
  body: string[];
};

type VariantContent = {
  eyebrow: string;
  title: string;
  intro: string;
  lastUpdated: string;
  sections: SectionContent[];
};

const content: Record<LegalPageProps["variant"], VariantContent> = {
  privacy: {
    eyebrow: "Legal",
    title: "Aviso de privacidad",
    intro:
      "Kova respeta tus datos. Este aviso describe qué información recolectamos, para qué la usamos y cómo puedes ejercer tus derechos como titular conforme a la LFPDPPP (México).",
    lastUpdated: "25 de mayo de 2026",
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
    eyebrow: "Legal · Versión 1.0",
    title: "Términos y condiciones de uso",
    intro:
      "Contrato de servicio SaaS. Al crear una cuenta, acceder o utilizar la plataforma Kova, usted acepta íntegramente los presentes Términos y Condiciones. Si no está de acuerdo con alguna de sus disposiciones, no utilice el servicio.",
    lastUpdated: "28 de mayo de 2026 (fecha de entrada en vigor)",
    sections: [
      {
        heading: "1. Definiciones",
        body: [
          "“Kova” o “Plataforma”: Software como Servicio (SaaS) de administración comercial para negocios, accesible en web y aplicación móvil.",
          "“Usuario”: Cualquier persona física o moral que crea una cuenta y utiliza la plataforma.",
          "“Cuenta”: Perfil único creado por el usuario para acceder a los servicios de Kova.",
          "“Contenido del Usuario”: Información, imágenes, datos y materiales que el usuario sube o genera en la plataforma.",
          "“Servicio”: El conjunto de funcionalidades ofrecidas por Kova: cobro de ventas, administración de inventario, control de caja y generación de reportes.",
        ],
      },
      {
        heading: "2. Aceptación y elegibilidad",
        body: [
          "2.1 Para utilizar Kova, usted debe: (i) ser mayor de 18 años y contar con capacidad legal suficiente para celebrar contratos vinculantes conforme a la legislación aplicable; (ii) tener capacidad legal para celebrar contratos vinculantes; (iii) proporcionar información veraz y actualizada al registrarse.",
          "2.2 Al marcar la casilla de aceptación o utilizar el servicio, usted declara haber leído, comprendido y aceptado estos Términos, el Aviso de Privacidad y la Política de Cookies.",
          "2.3 Si utiliza Kova en nombre de una empresa o negocio, declara tener autoridad para vincular a dicha entidad con estos Términos.",
        ],
      },
      {
        heading: "3. Registro y seguridad de la cuenta",
        body: [
          "3.1 El usuario es responsable de mantener la confidencialidad de sus credenciales de acceso. Kova no será responsable por accesos no autorizados derivados de negligencia del usuario en la custodia de sus credenciales.",
          "3.2 El usuario debe notificar a Kova de inmediato ante cualquier uso no autorizado de su cuenta mediante: posprojectsupport@gmail.com.",
          "3.3 Kova se reserva el derecho de suspender, bloquear o eliminar cuentas que presenten actividad sospechosa, incumplan estos Términos, o que a juicio de Kova representen un riesgo para la plataforma o sus usuarios.",
        ],
      },
      {
        heading: "4. Descripción del servicio y limitaciones",
        body: [
          "4.1 Kova es una herramienta de administración operacional para negocios. El servicio incluye: registro de productos, control de inventario, procesamiento de ventas, control de caja, generación de reportes y acceso desde múltiples dispositivos.",
          "4.2 Kova no es una institución financiera, banco, ni procesador de pagos regulado. Los servicios de pago son facilitados a través de terceros certificados bajo sus propias regulaciones.",
          "4.3 La disponibilidad del servicio es un objetivo de Kova, pero no está garantizada de forma absoluta. Pueden ocurrir interrupciones por mantenimiento, actualizaciones, fallas de infraestructura o causas de fuerza mayor.",
        ],
      },
      {
        heading: "5. Planes, precios y facturación",
        body: [
          "5.1 Kova ofrece un período de prueba gratuita de 7 días sin requerir método de pago. Al finalizar, el usuario deberá contratar un plan de pago para continuar.",
          "5.2 Incumplimiento de pago. El incumplimiento de pago podrá resultar en: (i) suspensión temporal de funcionalidades premium; (ii) suspensión total de la cuenta tras 180 días naturales de mora; y (iii) restricción de acceso a la información asociada a la cuenta mientras el adeudo permanezca pendiente.",
          "5.3 Kova no procesa directamente datos de tarjetas de crédito. Los datos de pago son manejados íntegramente por procesadores certificados PCI-DSS.",
        ],
      },
      {
        heading: "6. Propiedad intelectual",
        body: [
          "6.1 Kova y sus componentes (software, diseño, marca, logotipos, algoritmos, base de datos estructural) son propiedad intelectual de Kova y están protegidos por las leyes mexicanas e internacionales de propiedad intelectual.",
          "6.2 Titularidad del contenido del usuario. El usuario conserva íntegramente la titularidad y propiedad sobre todo el contenido que sube a la plataforma (imágenes de productos, datos de inventario, registros comerciales, etc.). Kova NO adquiere ningún derecho de propiedad sobre dicho contenido.",
          "6.3 Licencia del usuario a Kova. Al subir contenido, el usuario otorga a Kova una licencia limitada, no exclusiva, no transferible, revocable y libre de regalías, únicamente para: (i) almacenar el contenido en los servidores de la plataforma; (ii) procesar y mostrar el contenido dentro de la plataforma para la correcta operación del servicio; (iii) realizar copias de seguridad como medida técnica de protección. Esta licencia NO incluye el derecho de Kova a comercializar, sublicenciar, publicitar o compartir el contenido del usuario con terceros no vinculados al servicio.",
          "6.4 El usuario garantiza que el contenido que sube no infringe derechos de terceros y asume total responsabilidad por el contenido que introduce en la plataforma.",
        ],
      },
      {
        heading: "7. Uso aceptable y conductas prohibidas",
        body: [
          "El usuario se compromete expresamente a NO:",
          "• Utilizar la plataforma para actividades ilegales, fraudulentas o que violen derechos de terceros.",
          "• Subir contenido que infrinja derechos de propiedad intelectual de terceros.",
          "• Intentar acceder, modificar, dañar o interrumpir sistemas de Kova o cuentas de otros usuarios.",
          "• Usar técnicas de ingeniería inversa, descompilación o desensamblado del software.",
          "• Revender, sublicenciar o transferir el acceso a la plataforma sin autorización escrita de Kova.",
          "• Subir malware, virus, ransomware u otro código dañino.",
          "• Utilizar la plataforma para almacenar o procesar datos de terceros sin las autorizaciones legales correspondientes.",
          "• Sobrecargar intencionalmente la infraestructura de Kova (ataques de denegación de servicio).",
          "• Eludir medidas de seguridad, autenticación o control de acceso de la plataforma.",
        ],
      },
      {
        heading: "8. Moderación y gestión de contenido",
        body: [
          "8.1 Kova se reserva el derecho de revisar, moderar, suspender o eliminar contenido que: (i) viole estos Términos o la legislación aplicable; (ii) sea reportado como infractor de derechos de terceros; (iii) represente un riesgo de seguridad para la plataforma o sus usuarios.",
          "8.2 Kova notificará al usuario, cuando sea posible y legalmente permitido, sobre las acciones de moderación que afecten su cuenta, salvo que la notificación comprometa una investigación de seguridad o sea prohibida por autoridad competente.",
        ],
      },
      {
        heading: "9. Disponibilidad del servicio y fuerza mayor digital",
        body: [
          "9.1 Kova realizará esfuerzos razonables para mantener el servicio disponible, pero no garantiza disponibilidad ininterrumpida o libre de errores.",
          "9.2 Kova no será responsable por interrupciones o fallas causadas por: (i) fallas en servicios de terceros (proveedores de nube, procesadores de pago, CDNs, APIs externas); (ii) ataques cibernéticos externos; (iii) cortes de internet o telecomunicaciones; (iv) fuerza mayor (desastres naturales, pandemias, actos de autoridad); (v) mantenimiento programado con aviso previo; (vi) errores o fallos de dispositivos del usuario.",
          "9.3 Kova comunicará las interrupciones programadas con al menos 24 horas de anticipación, salvo emergencias técnicas.",
        ],
      },
      {
        heading: "10. Cancelación y eliminación de cuenta",
        body: [
          "10.1 El usuario puede cancelar su cuenta en cualquier momento desde la configuración de su perfil o solicitándolo a posprojectsupport@gmail.com.",
          "10.2 Tras la cancelación, Kova conservará los datos del usuario por un período máximo de 180 días naturales para posibilitar la reactivación y para fines de seguridad y cumplimiento legal.",
          "10.3 Kova puede terminar la cuenta del usuario si: (i) viola estos Términos de forma grave o reiterada; (ii) no paga el servicio transcurrido el período de gracia; (iii) la cuenta presenta actividad fraudulenta o ilegal.",
          "10.4 El usuario tiene derecho a exportar sus datos antes de la cancelación. Kova facilitará esta exportación en formato estándar mediante solicitud a posprojectsupport@gmail.com.",
        ],
      },
      {
        heading: "11. Divisibilidad e integración",
        body: [
          "Si alguna cláusula de estos Términos fuera declarada nula, inválida o inaplicable por autoridad competente, dicha declaración no afectará la validez y exigibilidad del resto de los Términos, que continuarán en plena vigencia. Los presentes Términos, junto con el Aviso de Privacidad y la Política de Cookies, constituyen el acuerdo íntegro entre las partes en relación con el uso del servicio, y reemplazan cualquier acuerdo previo sobre la misma materia.",
        ],
      },
      {
        heading: "12. No renuncia",
        body: [
          "El hecho de que Kova no ejerza o no haga cumplir algún derecho o disposición de estos Términos no constituirá una renuncia a dicho derecho o disposición. Kova podrá ejercer sus derechos en cualquier momento futuro.",
        ],
      },
      {
        heading: "13. Jurisdicción y ley aplicable",
        body: [
          "Los presentes Términos se regirán e interpretarán conforme a las leyes federales aplicables de los Estados Unidos Mexicanos.",
          "Para cualquier controversia derivada de estos Términos, las partes se someten a la jurisdicción de los tribunales competentes de México, renunciando, en la medida permitida por la legislación aplicable, a cualquier otro fuero que pudiera corresponderles por razón de su domicilio presente o futuro, ubicación o cualquier otra causa.",
          "Sin perjuicio de lo anterior, cuando la legislación aplicable reconozca al usuario derechos irrenunciables en materia de protección al consumidor, privacidad, protección de datos personales u otras normas obligatorias de su país de residencia, Kova respetará dichos derechos en la medida en que resulten aplicables.",
        ],
      },
      {
        heading: "14. Modificaciones a los términos",
        body: [
          "Kova se reserva el derecho de modificar estos Términos. Los cambios materiales serán notificados con al menos 15 días de anticipación. El uso continuado del servicio después de la notificación implica aceptación de los nuevos términos. Si no acepta los cambios, debe cancelar su cuenta antes de la fecha de entrada en vigor.",
        ],
      },
      {
        heading: "Contacto",
        body: [
          "Para dudas, soporte o ejercicio de derechos relacionados con estos Términos: posprojectsupport@gmail.com.",
        ],
      },
    ],
  },
  security: {
    eyebrow: "Seguridad",
    title: "Cómo protegemos tu negocio",
    intro:
      "Kova maneja la operación de tu PyME: ventas, inventario, turnos, y datos de tus clientes. Esta página explica con honestidad cómo cuidamos esa información durante la beta y qué puedes esperar de nosotros.",
    lastUpdated: "25 de mayo de 2026",
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
          Última actualización: {data.lastUpdated}
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

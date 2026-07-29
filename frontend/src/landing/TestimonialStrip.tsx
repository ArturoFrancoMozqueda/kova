// Strip compacto de prueba social justo después del hero-film: los quotes
// reales aparecen en los primeros segundos, no ocho pantallas abajo. Es un
// <aside> SIN id a propósito — no entra al funnel de landing_section_viewed
// (los section[id] de <main> son la serie histórica comparable). Usa <q> y no
// <blockquote> para no alterar el conteo que Home.test fija sobre #clientes.
// Gateado por datos igual que Testimonials: sin quotes reales, no existe.
import { copy } from "@/i18n/messages";
import { TESTIMONIALS, type Testimonial } from "./testimonials.data";

const t = copy.landing.testimonials;

export default function TestimonialStrip({
  items = TESTIMONIALS,
}: {
  items?: readonly Testimonial[];
}) {
  if (items.length === 0) return null;

  return (
    <aside
      aria-label={t.stripAria}
      style={{
        padding: "26px 32px",
        borderTop: "0.5px solid var(--hairline-color)",
        background: "var(--surface)",
      }}
    >
      <div
        className="lp-quote-strip"
        style={{
          maxWidth: 1180, margin: "0 auto",
          display: "flex", flexWrap: "wrap", alignItems: "baseline",
          gap: "10px 40px",
        }}
      >
        <span
          style={{
            fontSize: 11, fontWeight: 600, letterSpacing: "0.14em",
            textTransform: "uppercase", color: "var(--text-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          {t.stripEyebrow}
        </span>
        {items.map((item) => (
          <p key={item.business} style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--text-muted)", flex: "1 1 320px", minWidth: 0 }}>
            <q style={{ fontStyle: "italic" }}>{item.quote}</q>{" "}
            <span style={{ whiteSpace: "nowrap", color: "var(--page-fg)", fontWeight: 600 }}>— {item.business}</span>
          </p>
        ))}
      </div>
    </aside>
  );
}

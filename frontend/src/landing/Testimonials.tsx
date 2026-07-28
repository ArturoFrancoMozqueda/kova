// Sección #clientes: prueba social con testimonios reales. Gateada por datos
// — con TESTIMONIALS vacío devuelve null y la sección no existe en el DOM ni
// en el prerender ni en landing_section_viewed. Ver testimonials.data.ts para
// los requisitos antes de publicar un testimonio.
import { copy } from "@/i18n/messages";
import { TESTIMONIALS, type Testimonial } from "./testimonials.data";

const t = copy.landing.testimonials;

export default function Testimonials({
  items = TESTIMONIALS,
}: {
  items?: readonly Testimonial[];
}) {
  if (items.length === 0) return null;

  return (
    <section id="clientes" className="lp-section lp-section-compact">
      <div className="lp-section-inner">
        <div data-lp-stagger-group>
          <span className="lp-section-label" data-lp-stagger-item>{t.eyebrow}</span>
          <h2 className="lp-section-title" data-lp-stagger-item style={{ maxWidth: 760 }}>{t.title}</h2>
        </div>

        <ul className="lp-testimonials-grid" data-lp-stagger-group style={{ listStyle: "none", padding: 0, margin: "40px 0 0" }}>
          {items.map((item) => (
            <li
              key={item.business}
              className="lp-lift"
              data-lp-stagger-item
              style={{
                background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                borderRadius: 12, padding: "30px 28px",
                display: "flex", flexDirection: "column", gap: 18,
              }}
            >
              <blockquote
                style={{
                  margin: 0, fontSize: 17, lineHeight: 1.55, fontWeight: 500,
                  letterSpacing: "-0.01em", color: "var(--page-fg)",
                }}
              >
                “{item.quote}”
              </blockquote>
              <footer style={{ marginTop: "auto", fontSize: 13, color: "var(--text-muted)" }}>
                — <span style={{ fontWeight: 600, color: "var(--page-fg)" }}>{item.name ?? item.business}</span>
                {item.name ? `, ${item.business}` : ""}
                {item.city ? ` · ${item.city}` : ""}
              </footer>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

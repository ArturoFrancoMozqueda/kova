// Sección "¿Es para mí?" (#comercios): el link del navbar apuntaba a un ancla
// escondida dentro del bento; esta sección la vuelve una respuesta real usando
// el copy de builtFor. Las etiquetas de honestidad (Recomendado / Compatible /
// Caso por caso) son parte del argumento de venta: también decimos a quién
// NO le queda Kova todavía.
import type { CSSProperties } from "react";
import { copy } from "@/i18n/messages";

const t = copy.landing.builtFor;

const TAG_STYLES: Record<string, CSSProperties> = {
  recommended: {
    background: "rgba(30,191,138,0.14)",
    color: "var(--kova-growth)",
    borderColor: "rgba(30,191,138,0.35)",
  },
  compatible: {
    background: "var(--accent-soft)",
    color: "var(--accent)",
    borderColor: "var(--accent)",
  },
  "case-by-case": {
    background: "var(--surface-2)",
    color: "var(--text-muted)",
    borderColor: "var(--hairline-color)",
  },
};

export default function BuiltFor() {
  return (
    <section
      id="comercios"
      className="lp-section"
      style={{ background: "var(--kova-ink)", scrollMarginTop: 72 }}
    >
      <div className="lp-section-inner">
        <div data-lp-stagger-group>
          <span className="lp-section-label" data-lp-stagger-item>{t.eyebrow}</span>
          <h2 className="lp-section-title" data-scale="quiet" data-lp-stagger-item style={{ maxWidth: 760 }}>{t.title}</h2>
          <p className="lp-section-copy" data-lp-stagger-item>{t.body}</p>
        </div>

        <ul className="lp-builtfor-grid" data-lp-stagger-group style={{ listStyle: "none", padding: 0, margin: "40px 0 0" }}>
          {t.types.map((type) => (
            <li
              key={type.name}
              className="lp-lift"
              data-lp-stagger-item
              style={{
                background: "var(--surface)", border: "0.5px solid var(--hairline-color)",
                borderRadius: 12, padding: "26px 24px",
                display: "flex", flexDirection: "column", gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--page-fg)" }}>
                  {type.name}
                </h3>
                <span
                  style={{
                    fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999,
                    border: "0.5px solid", whiteSpace: "nowrap",
                    ...TAG_STYLES[type.fit],
                  }}
                >
                  {type.tag}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--text-muted)" }}>{type.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

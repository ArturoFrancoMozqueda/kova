// Visual principal del hero: el POS de Sweet Home dentro de un marco tipo
// ventana de app, con la venta de $186 ya cargada e interactividad limitada.
import { SWEET_HOME_BUSINESS } from "@/landing/demo/sweetHome";
import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";

export default function HeroProductPreview() {
  return (
    <div
      className="lp-hero-preview"
      style={{
        width: "100%",
        borderRadius: 14,
        border: "0.5px solid var(--hairline-strong)",
        background: "var(--surface-2)",
        boxShadow: "var(--kova-shadow-hero, 0 24px 60px -20px rgba(15,17,23,0.45))",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px",
          borderBottom: "0.5px solid var(--hairline-color)",
          background: "var(--surface)",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", gap: 5 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 8, height: 8, borderRadius: 999, background: "var(--chip-bg)", border: "0.5px solid var(--hairline-strong)" }} />
          ))}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {SWEET_HOME_BUSINESS.name} · {SWEET_HOME_BUSINESS.tagline}
        </span>
      </div>
      <SweetHomePOSPreview interactive />
    </div>
  );
}

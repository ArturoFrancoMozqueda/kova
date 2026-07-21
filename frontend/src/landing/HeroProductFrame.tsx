// Marco de producto del hero: una ventana de navegador refinada que enmarca el
// POS real (SweetHomePOSPreview) renderizado en el tema CLARO del producto, para
// que lo primero arriba del pliegue sea la Kova real y no un mockup inventado.
//
// Determinismo de prerender: estático (interactive=false → todos los controles
// deshabilitados y fuera del orden de tabulación; sin animateEntry → sin rAF).
// Renderiza los mismos pixeles en servidor y cliente. Decorativo: aria-hidden
// para no exponer un POS falso a lectores de pantalla — la historia la cuenta la
// copy del hero.
import type { CSSProperties } from "react";
import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";
import { themeVars } from "@/landing/landingTheme";
import { copy } from "@/i18n/messages";

const trafficDot: CSSProperties = { width: 10, height: 10, borderRadius: 999, display: "inline-block" };

export default function HeroProductFrame() {
  return (
    <div className="lp-hero-frame" aria-hidden="true">
      <div className="lp-hero-frame-bar">
        <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
          <span style={{ ...trafficDot, background: "#FF5F57" }} />
          <span style={{ ...trafficDot, background: "#FEBC2E" }} />
          <span style={{ ...trafficDot, background: "#28C840" }} />
        </span>
        <span className="lp-hero-frame-url">{copy.landing.showcase.urlBar}</span>
        <span style={{ width: 44, flexShrink: 0 }} />
      </div>
      <div className="lp-hero-frame-screen" style={themeVars("light")}>
        <SweetHomePOSPreview interactive={false} />
      </div>
    </div>
  );
}

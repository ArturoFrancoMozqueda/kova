// Vista estática y sanitizada de la Caja productiva. La única superficie
// operable de marketing vive en KovaShowcase, así el hero nunca parece una demo
// rota o parcialmente interactiva.
import type { CSSProperties } from "react";
import { copy } from "@/i18n/messages";

const trafficDot: CSSProperties = { width: 10, height: 10, borderRadius: 999, display: "inline-block" };

export default function HeroProductFrame() {
  return (
    <figure className="lp-hero-frame">
      <div className="lp-hero-frame-bar">
        <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
          <span style={{ ...trafficDot, background: "#FF5F57" }} />
          <span style={{ ...trafficDot, background: "#FEBC2E" }} />
          <span style={{ ...trafficDot, background: "#28C840" }} />
        </span>
        <span className="lp-hero-frame-url">{copy.landing.showcase.urlBar}</span>
        <span style={{ width: 44, flexShrink: 0 }} />
      </div>
      <div className="lp-hero-frame-screen">
        <img
          src="/showcase/register.png"
          alt="Vista real sanitizada de la Caja de Kova con un carrito de $186.00"
          className="lp-hero-product-capture"
          width={1440}
        height={900}
        loading="eager"
        decoding="async"
        />
      </div>
      <figcaption className="lp-hero-capture-label">Vista real del producto</figcaption>
    </figure>
  );
}

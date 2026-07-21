// Sección "Una venta lo mueve todo": la narrativa auto-guiada (a diferencia del
// showcase cinemático auto-reproducido). Cuatro filas alternadas — copy de un
// lado, preview real del producto del otro — que siguen la MISMA venta de $186
// de Sweet Home a través de Venta → Inventario → Caja → Reportes.
//
// Los previews son las réplicas reales alimentadas por landing/demo/sweetHome,
// renderizados estáticos (interactive=false / animate=false): la historia se
// entiende sin animación y es determinista para el prerender. El movimiento lo
// aporta el reveal-on-scroll (useRevealMotion): la copy revela escalonada por
// [data-lp-stagger-group] y el preview con la variante "frame".
import type { ReactNode } from "react";
import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";
import InventoryStatePreview from "@/landing/previews/InventoryStatePreview";
import CashRegisterPreview from "@/landing/previews/CashRegisterPreview";
import ReportsPreview from "@/landing/previews/ReportsPreview";
import { copy } from "@/i18n/messages";

const t = copy.landing.saleStory;

const PREVIEWS: ReactNode[] = [
  <SweetHomePOSPreview interactive={false} />,
  <InventoryStatePreview animate={false} />,
  <CashRegisterPreview animate={false} />,
  <ReportsPreview animate={false} />,
];

export default function SaleStory() {
  return (
    <section id="una-venta" className="lp-section">
      <div className="lp-section-inner">
        <div data-lp-stagger-group>
          <span className="lp-section-label" data-lp-stagger-item style={{ color: "var(--accent)" }}>
            {t.kicker}
          </span>
          <h2 className="lp-section-title" data-lp-stagger-item style={{ maxWidth: 760 }}>
            {t.title}
          </h2>
          <p className="lp-section-copy" data-lp-stagger-item style={{ maxWidth: 620 }}>
            {t.line}
          </p>
        </div>

        <div className="lp-story-rows">
          {t.steps.map((step, i) => (
            <div className="lp-sale-row" data-reverse={i % 2 === 1 ? "1" : "0"} key={step.eyebrow}>
              <div className="lp-sale-copy" data-lp-stagger-group>
                <span className="lp-sale-step" data-lp-stagger-item>
                  <span className="lp-sale-step-num tabular">{String(i + 1).padStart(2, "0")}</span>
                  {step.eyebrow}
                </span>
                <h3 className="lp-sale-title" data-lp-stagger-item>
                  {step.title}
                </h3>
                <p className="lp-sale-body" data-lp-stagger-item>
                  {step.body}
                </p>
              </div>
              <div
                className="lp-sale-visual"
                data-lp-reveal-opt
                data-lp-reveal-variant="frame"
              >
                <div className="lp-sale-frame">{PREVIEWS[i]}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

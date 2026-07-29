// Sección "Una venta lo mueve todo": la prueba de causa y efecto que el
// hero-film no da. Tres filas alternadas — copy de un lado, preview real del
// producto del otro — que siguen la MISMA venta de $186 de Sweet Home por
// Venta → Inventario → Caja. El cuarto beat (el análisis) vive en
// OwnerDashboard (#panel-dueno): la historia termina en la pantalla del dueño.
//
// Los previews montan estáticos y deterministas para el prerender; su
// coreografía (pop de galleta, count-up del total, stock que baja, efectivo
// esperado subiendo) arranca cuando la fila entra al viewport, vía
// useInViewOnce — el mismo momento en que el reveal la hace visible.
import { useRef, type ReactNode } from "react";

import SweetHomePOSPreview from "@/landing/previews/SweetHomePOSPreview";
import InventoryStatePreview from "@/landing/previews/InventoryStatePreview";
import CashRegisterPreview from "@/landing/previews/CashRegisterPreview";
import { useInViewOnce } from "@/landing/previews/useInViewOnce";
import { copy } from "@/i18n/messages";

const t = copy.landing.saleStory;

const PREVIEWS: ((seen: boolean) => ReactNode)[] = [
  (seen) => <SweetHomePOSPreview interactive={false} animateEntry={seen} />,
  (seen) => <InventoryStatePreview animate={seen} />,
  (seen) => <CashRegisterPreview animate={seen} />,
];

function SaleBeat({
  step,
  index,
}: {
  step: (typeof t.steps)[number];
  index: number;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(rowRef);

  return (
    <div className="lp-sale-row" data-reverse={index % 2 === 1 ? "1" : "0"} ref={rowRef}>
      <div className="lp-sale-copy" data-lp-stagger-group>
        <span className="lp-sale-step" data-lp-stagger-item>
          <span className="lp-sale-step-num tabular">{String(index + 1).padStart(2, "0")}</span>
          {step.eyebrow}
        </span>
        <h3 className="lp-sale-title" data-lp-stagger-item>
          {step.title}
        </h3>
        <p className="lp-sale-body" data-lp-stagger-item>
          {step.body}
        </p>
      </div>
      <div className="lp-sale-visual" data-lp-reveal-opt data-lp-reveal-variant="frame">
        <div className="lp-sale-frame">{PREVIEWS[index]?.(seen)}</div>
      </div>
    </div>
  );
}

export default function SaleStory() {
  return (
    <section id="una-venta" className="lp-section lp-section-tight">
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
            <SaleBeat key={step.eyebrow} step={step} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

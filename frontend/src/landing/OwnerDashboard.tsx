// Sección "Al final del día": el beat 04 de la historia de la venta y la
// recreación del Panel real (dashboard/DashboardView.tsx) — el payoff del
// dueño. Misma fuente de datos que la historia: cuando la sección entra al
// viewport, la venta de $186 entra visiblemente a los totales (count-ups
// desde el estado previo a la venta hasta SWEET_HOME_REPORTS).
import { useRef, type CSSProperties, type ReactNode } from "react";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";
import {
  SWEET_HOME_EMPLOYEES,
  SWEET_HOME_PRODUCTS,
  SWEET_HOME_REPORTS,
  SWEET_HOME_SALE_TOTAL,
} from "@/landing/demo/sweetHome";
import { HoursMiniChart, PaymentSplitBar } from "@/landing/previews/ReportsPreview";
import { useCountUp } from "@/landing/previews/useCountUp";
import { useInViewOnce } from "@/landing/previews/useInViewOnce";

const dash = copy.dashboard;
const t = copy.landing.ownerDashboard;

const kpiLabelStyle: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

const panelStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "var(--surface-2)",
  border: "0.5px solid var(--hairline-color)",
  minWidth: 0,
};

const panelTitleStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  marginBottom: 8,
};

function Kpi({
  label,
  value,
  sub,
  secondary = false,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  secondary?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div className="lp-own-kpi" data-secondary={secondary ? "1" : "0"} style={panelStyle}>
      <span style={kpiLabelStyle}>{label}</span>
      <div className="tabular" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap", marginTop: 2 }}>
        {value}
      </div>
      {badge}
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function OwnerDashboardPreview({ animate }: { animate: boolean }) {
  const r = SWEET_HOME_REPORTS;
  const owner = SWEET_HOME_EMPLOYEES.find((e) => e.role === "owner");
  const topProducts = r.topProductIds
    .map((id) => SWEET_HOME_PRODUCTS.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  // La venta de las 5:42 PM entrando a los totales: ventas netas suben desde
  // el día sin esa venta y las órdenes cuentan la nueva. Estático (prerender,
  // reduced-motion) muestra directamente los totales finales.
  const countedNetSales = useCountUp(r.netSales, {
    from: r.netSales - SWEET_HOME_SALE_TOTAL,
    durationMs: 400,
    delayMs: 160,
    animate,
  });
  const countedOrders = useCountUp(r.orders, {
    from: r.orders - 1,
    durationMs: 300,
    delayMs: 160,
    animate,
  });

  return (
    <div
      className="lp-own-preview"
      data-lp-anim={animate ? "on" : "off"}
      style={{
        background: "var(--card-bg)",
        border: "0.5px solid var(--hairline-color)",
        borderRadius: 12,
        overflow: "hidden",
        color: "var(--page-fg)",
        textAlign: "left",
        boxShadow: "0 24px 60px -28px rgba(0,0,0,0.55)",
      }}
    >
      <div style={{ padding: "14px 18px", borderBottom: "0.5px solid var(--hairline-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {dash.greetingAfternoon}, {owner?.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span className="lp-live-dot" /> {copy.landing.sweetHome.shopName}
          </div>
        </div>
        <span
          style={{
            fontSize: 10.5, fontWeight: 600, padding: "2px 10px", borderRadius: 999,
            background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
          }}
        >
          {dash.periodDay}
        </span>
      </div>

      <div className="lp-own-kpis" style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <Kpi
          label={dash.netSales}
          value={formatMoney(countedNetSales)}
          badge={
            <span
              className="lp-story-fade"
              style={{
                display: "inline-flex", marginTop: 5,
                fontSize: 10, fontWeight: 600, padding: "1px 8px", borderRadius: 999,
                background: "rgba(30,191,138,0.14)", color: "var(--kova-growth)",
                whiteSpace: "nowrap",
                ["--lp-entry-delay" as string]: "640ms",
              }}
            >
              ↑ {r.deltaVsYesterdayPct}% {dash.vsYesterday}
            </span>
          }
        />
        <Kpi label={dash.orders} value={String(countedOrders)} sub={dash.noVoidsToday} />
        <Kpi label={dash.avgTicket} value={formatMoney(r.avgTicket)} sub={dash.perCompletedOrder} />
        <Kpi label={dash.refunds} value={String(r.refunds)} sub={formatMoney(r.refunds)} secondary />
      </div>

      <div className="lp-own-bottom" style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1.15fr 1fr 0.9fr", gap: 10 }}>
        <div className="lp-own-secondary" style={panelStyle}>
          <div style={panelTitleStyle}>{dash.topHoursTitle}</div>
          <HoursMiniChart height={62} />
        </div>
        <div style={panelStyle}>
          <div style={panelTitleStyle}>{dash.paymentBreakdown}</div>
          <PaymentSplitBar />
        </div>
        <div className="lp-own-secondary" style={panelStyle}>
          <div style={panelTitleStyle}>{dash.topProducts}</div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {topProducts.map((p, i) => (
              <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, minWidth: 0 }}>
                <span className="tabular" style={{ color: i === 0 ? "var(--accent)" : "var(--text-tertiary)", fontWeight: 700, flexShrink: 0 }}>
                  {i + 1}.
                </span>
                <span style={{ fontWeight: i === 0 ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: i === 0 ? "var(--page-fg)" : "var(--text-muted)" }}>
                  {p.name}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const previewRef = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(previewRef);

  return (
    <section id="panel-dueno" className="lp-section lp-section-tight lp-reveal-block">
      <div className="lp-section-inner">
        {/* Chip "04": esta sección es el cuarto beat de la historia de la
            venta (#una-venta trae 01–03), aunque conserva su id propio. */}
        <span className="lp-sale-step" style={{ color: "var(--text-muted)" }}>
          <span className="lp-sale-step-num tabular">04</span>
          {t.kicker}
        </span>
        <h2 className="lp-section-title" style={{ maxWidth: 720, marginTop: 14 }}>{t.title}</h2>
        <p className="lp-section-copy">{t.line}</p>
        <div ref={previewRef} style={{ marginTop: 36, maxWidth: 980, marginLeft: "auto", marginRight: "auto" }}>
          <OwnerDashboardPreview animate={seen} />
        </div>
      </div>
    </section>
  );
}

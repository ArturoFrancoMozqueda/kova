// Sección "Al final del día" (brief §1.3/§2.7): recreación del Panel real
// (dashboard/DashboardView.tsx) — el payoff del dueño. Misma fuente de datos
// que la historia: la venta de $186 ya está dentro de estos totales.
import type { CSSProperties, ReactNode } from "react";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";
import {
  SWEET_HOME_EMPLOYEES,
  SWEET_HOME_PRODUCTS,
  SWEET_HOME_REPORTS,
} from "@/landing/demo/sweetHome";
import { HoursMiniChart, PaymentSplitBar } from "@/landing/previews/ReportsPreview";

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

function OwnerDashboardPreview() {
  const r = SWEET_HOME_REPORTS;
  const owner = SWEET_HOME_EMPLOYEES.find((e) => e.role === "owner");
  const topProducts = r.topProductIds
    .map((id) => SWEET_HOME_PRODUCTS.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <div
      className="lp-own-preview"
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
          value={formatMoney(r.netSales)}
          badge={
            <span
              style={{
                display: "inline-flex", marginTop: 5,
                fontSize: 10, fontWeight: 600, padding: "1px 8px", borderRadius: 999,
                background: "rgba(30,191,138,0.14)", color: "var(--kova-growth)",
                whiteSpace: "nowrap",
              }}
            >
              ↑ {r.deltaVsYesterdayPct}% {dash.vsYesterday}
            </span>
          }
        />
        <Kpi label={dash.orders} value={String(r.orders)} sub={dash.noVoidsToday} />
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
  return (
    <section id="panel-dueno" className="lp-section lp-reveal-block">
      <div className="lp-section-inner">
        <span className="lp-section-label">{t.kicker}</span>
        <h2 className="lp-section-title" style={{ maxWidth: 720 }}>{t.title}</h2>
        <p className="lp-section-copy">{t.line}</p>
        <div style={{ marginTop: 36, maxWidth: 980, marginLeft: "auto", marginRight: "auto" }}>
          <OwnerDashboardPreview />
        </div>
      </div>
    </section>
  );
}

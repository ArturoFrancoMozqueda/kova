// Recreación compacta de Reportes/Panel vista "Hoy" (reports/ReportsView.tsx,
// dashboard/DashboardView.tsx). Cierre de la historia: la orden #37 de $186
// ya forma parte de los totales del día.
import type { CSSProperties } from "react";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";
import { SWEET_HOME_PRODUCTS, SWEET_HOME_REPORTS, SWEET_HOME_SALE_TOTAL } from "@/landing/demo/sweetHome";
import { useCountUp } from "@/landing/previews/useCountUp";

const dash = copy.dashboard;
const t = copy.landing.sweetHome;

const kpiLabelStyle: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

const panelTitleStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
  marginBottom: 8,
};

/** Mini bar chart "Tus mejores horas" — compartido con OwnerDashboardPreview. */
export function HoursMiniChart({ height = 56 }: { height?: number }) {
  const r = SWEET_HOME_REPORTS;
  return (
    <div
      role="img"
      aria-label={t.bestHoursSummary(r.bestHoursLabel)}
      style={{ display: "flex", alignItems: "flex-end", gap: 5, height }}
    >
      {r.hourly.map((bar, i) => (
        <div
          key={bar.label}
          className="lp-rep-bar"
          data-extra={i < r.hourly.length - 5 ? "1" : "0"}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, height: "100%", justifyContent: "flex-end", minWidth: 0 }}
        >
          <div
            className="lp-bar"
            style={{
              width: "100%",
              height: `${Math.round(bar.pct * 0.78)}%`,
              borderRadius: 3,
              background: bar.best ? "var(--accent)" : "rgba(255,255,255,0.16)",
              ["--lp-fade-delay" as string]: `${120 + i * 50}ms`,
            }}
          />
          <span style={{ fontSize: 7.5, color: bar.best ? "var(--accent)" : "var(--text-tertiary)", fontWeight: bar.best ? 700 : 500, whiteSpace: "nowrap" }}>
            {bar.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Barra apilada "Cómo te pagaron" + leyenda — compartida con OwnerDashboardPreview. */
export function PaymentSplitBar() {
  const r = SWEET_HOME_REPORTS;
  return (
    <>
      <div
        role="img"
        aria-label={`${dash.paymentBreakdown}: ${t.paymentCash} ${r.cashSharePct}%, ${t.paymentCard} ${r.cardSharePct}%`}
        style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--chip-bg)" }}
      >
        <div className="lp-fill" style={{ background: "var(--kova-growth)", ["--lp-fill" as string]: `${r.cashSharePct}%`, width: `${r.cashSharePct}%` }} />
        <div className="lp-fill" style={{ background: "var(--accent)", ["--lp-fill" as string]: `${r.cardSharePct}%`, width: `${r.cardSharePct}%` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 7, fontSize: 10, color: "var(--text-muted)", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: "var(--kova-growth)" }} />
          {t.paymentCash} <span className="tabular" style={{ fontWeight: 600, color: "var(--page-fg)" }}>{r.cashSharePct}%</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent)" }} />
          {t.paymentCard} <span className="tabular" style={{ fontWeight: 600, color: "var(--page-fg)" }}>{r.cardSharePct}%</span>
        </span>
      </div>
    </>
  );
}

export default function ReportsPreview({ animate = true }: { animate?: boolean }) {
  const r = SWEET_HOME_REPORTS;
  const netSales = useCountUp(r.netSales, {
    from: r.netSales - SWEET_HOME_SALE_TOTAL,
    durationMs: 400,
    delayMs: 150,
    animate,
  });
  const orders = useCountUp(r.orders, { from: r.orders - 1, durationMs: 300, delayMs: 230, animate });
  const topProduct = SWEET_HOME_PRODUCTS.find((p) => p.id === r.topProductId);

  return (
    <div
      className="lp-rep-preview"
      data-lp-anim={animate ? "on" : "off"}
      style={{
        background: "var(--card-bg)",
        border: "0.5px solid var(--hairline-color)",
        borderRadius: 10,
        overflow: "hidden",
        color: "var(--page-fg)",
        textAlign: "left",
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--hairline-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{copy.reportsView.title}</span>
        <span
          style={{
            fontSize: 10.5, fontWeight: 600, padding: "2px 10px", borderRadius: 999,
            background: "var(--invert-ink-bg)", color: "var(--invert-ink-fg)",
          }}
        >
          {dash.periodDay}
        </span>
      </div>

      <div className="lp-rep-kpis" style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <div className="lp-rep-kpi" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "0.5px solid var(--hairline-color)", minWidth: 0 }}>
          <span style={kpiLabelStyle}>{dash.netSales}</span>
          <div className="tabular" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
            {formatMoney(netSales)}
          </div>
          <span
            className="lp-story-fade"
            style={{
              display: "inline-flex", marginTop: 4,
              fontSize: 10, fontWeight: 600, padding: "1px 8px", borderRadius: 999,
              background: "rgba(30,191,138,0.14)", color: "var(--kova-growth)",
              whiteSpace: "nowrap",
              ["--lp-fade-delay" as string]: "640ms",
            }}
          >
            ↑ {r.deltaVsYesterdayPct}% {dash.vsYesterday}
          </span>
        </div>
        <div className="lp-rep-kpi" data-secondary="1" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "0.5px solid var(--hairline-color)", minWidth: 0 }}>
          <span style={kpiLabelStyle}>{dash.orders}</span>
          <div className="tabular" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>{orders}</div>
        </div>
        <div className="lp-rep-kpi" data-secondary="1" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "0.5px solid var(--hairline-color)", minWidth: 0 }}>
          <span style={kpiLabelStyle}>{dash.avgTicket}</span>
          <div className="tabular" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>
            {formatMoney(r.avgTicket)}
          </div>
        </div>
      </div>

      <div className="lp-rep-bottom" style={{ padding: "0 14px 14px", display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 8 }}>
        <div className="lp-rep-secondary" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "0.5px solid var(--hairline-color)", minWidth: 0 }}>
          <div style={panelTitleStyle}>{dash.topHoursTitle}</div>
          <HoursMiniChart />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "0.5px solid var(--hairline-color)" }}>
            <div style={panelTitleStyle}>{dash.paymentBreakdown}</div>
            <PaymentSplitBar />
          </div>
          <div className="lp-rep-secondary" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "0.5px solid var(--hairline-color)" }}>
            <div style={{ ...panelTitleStyle, marginBottom: 4 }}>{dash.topProducts}</div>
            <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              1. {topProduct?.name}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

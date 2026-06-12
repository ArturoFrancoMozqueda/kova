// Recreación en miniatura del turno activo real (shifts/ShiftView.tsx).
// El pago en Efectivo del POS es lo que mueve la caja: entra el movimiento
// de +$186 y el efectivo esperado pasa de $1,854 a $2,040.
import type { CSSProperties } from "react";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { formatMoney, formatMoneyDelta } from "@/orders/format";
import { localizeMovementType } from "@/shifts/format";
import { copy } from "@/i18n/messages";
import { SWEET_HOME_CASH_REGISTER } from "@/landing/demo/sweetHome";
import { useCountUp } from "@/landing/previews/useCountUp";

const shift = copy.shiftView;
const t = copy.landing.sweetHome;

const tileLabelStyle: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

export default function CashRegisterPreview({ animate = true }: { animate?: boolean }) {
  const r = SWEET_HOME_CASH_REGISTER;
  const expectedCash = useCountUp(r.expectedCashAfter, {
    from: r.expectedCashBefore,
    durationMs: 380,
    delayMs: 380,
    animate,
  });
  const cashSales = useCountUp(r.cashSalesAfter, {
    from: r.cashSalesBefore,
    durationMs: 380,
    delayMs: 300,
    animate,
  });

  const tiles = [
    { key: "opening", label: shift.openingCash, value: formatMoney(r.openingCash), secondary: true },
    { key: "cashSales", label: t.cashSales, value: formatMoney(cashSales), secondary: false },
    { key: "outflows", label: t.outflows, value: formatMoneyDelta(-r.outflows), secondary: true },
    { key: "expected", label: shift.expectedCashShort, value: formatMoney(expectedCash), secondary: false, accent: true },
  ];

  return (
    <div
      className="lp-cash-preview"
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
      <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--hairline-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{shift.activeShift}</span>
          <span
            style={{
              fontSize: 10, fontWeight: 600, padding: "2px 9px", borderRadius: 999,
              background: "rgba(30,191,138,0.14)", color: "var(--kova-growth)",
              whiteSpace: "nowrap",
            }}
          >
            {shift.badgeOpen}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {r.employee} · {t.sinceTime(r.openedAtLabel)}
        </span>
      </div>

      <div className="lp-cash-tiles" style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className={tile.accent ? "lp-cash-tile lp-flash" : "lp-cash-tile"}
            data-secondary={tile.secondary ? "1" : "0"}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: tile.accent ? "var(--accent-soft)" : "var(--surface-2)",
              border: tile.accent ? "1px solid var(--accent)" : "0.5px solid var(--hairline-color)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 0,
            }}
          >
            <span style={tileLabelStyle}>{tile.label}</span>
            <span
              className="tabular"
              style={{
                fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em",
                color: tile.accent ? "var(--accent)" : "var(--page-fg)",
                whiteSpace: "nowrap",
              }}
            >
              {tile.value}
            </span>
          </div>
        ))}
      </div>

      <div style={{ padding: "0 14px 14px" }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 6 }}>
          {shift.movements}
        </div>
        <ul className="lp-cash-rows" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <li
            className="lp-story-slide"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 10,
              background: "rgba(30,191,138,0.08)",
              border: "0.5px solid rgba(30,191,138,0.25)",
            }}
          >
            <ArrowUpCircle size={16} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--kova-growth)", flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.saleMovement}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                {localizeMovementType("cash_in")} · {r.newMovementTimeLabel}
              </div>
            </div>
            <span className="tabular" style={{ fontSize: 13, fontWeight: 700, color: "var(--kova-growth)", whiteSpace: "nowrap" }}>
              {formatMoneyDelta(r.newMovementAmount)}
            </span>
          </li>
          <li
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 10,
              background: "var(--surface-2)",
              border: "0.5px solid var(--hairline-color)",
            }}
          >
            <ArrowDownCircle size={16} strokeWidth={1.8} aria-hidden="true" style={{ color: "#F87171", flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.outflowNote}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{localizeMovementType("cash_out")}</div>
            </div>
            <span className="tabular" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {formatMoneyDelta(-r.outflows)}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

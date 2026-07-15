// Bento de capacidades (brief §1.4/§2.8): absorbe la grid de Features.
// Cada celda lleva una mini-viñeta de UI (no íconos solos) construida con
// labels reales del producto. Las 6 capacidades son las ya publicadas hoy.
import type { CSSProperties, ReactNode } from "react";
import { AlertTriangle, BarChart3, Calculator, CreditCard, Package, UsersRound, WifiOff } from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { formatMoney } from "@/orders/format";
import { localizeReconciliationStatus } from "@/shifts/format";
import { copy } from "@/i18n/messages";
import { SWEET_HOME_CASH_REGISTER, SWEET_HOME_PRODUCTS, SWEET_HOME_SALE_TOTAL } from "@/landing/demo/sweetHome";
import { HoursMiniChart } from "@/landing/previews/ReportsPreview";

const t = copy.landing.bento;
const sweet = copy.landing.sweetHome;

const chipStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 10px",
  borderRadius: 999,
  border: "0.5px solid var(--hairline-color)",
  background: "var(--surface-2)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

function PaymentChips() {
  const methods = [sweet.paymentCash, sweet.paymentTransfer, sweet.paymentCard, copy.register.splitPayment];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {methods.map((m, i) => (
        <span key={m} style={{ ...chipStyle, ...(i === 0 ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" } : {}) }}>
          {m}
        </span>
      ))}
    </div>
  );
}

function OfflineVignette() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 5 }}>
        <WifiOff size={11} strokeWidth={2} aria-hidden="true" />
        {copy.register.offline}
      </span>
      <span
        style={{
          fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 8,
          background: "var(--cta-blue, var(--kova-blue))", color: "#fff", whiteSpace: "nowrap",
        }}
      >
        {sweet.charge(formatMoney(SWEET_HOME_SALE_TOTAL))}
      </span>
    </div>
  );
}

function CashVignette() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderRadius: 10, background: "var(--surface-2)", border: "0.5px solid var(--hairline-color)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
        {copy.shiftView.expectedCashShort}{" "}
        <span className="tabular" style={{ fontWeight: 700, color: "var(--page-fg)" }}>{formatMoney(SWEET_HOME_CASH_REGISTER.expectedCashAfter)}</span>
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 8px", borderRadius: 999, background: "rgba(30,191,138,0.14)", color: "var(--kova-growth)", whiteSpace: "nowrap" }}>
        {localizeReconciliationStatus("balanced")}
      </span>
    </div>
  );
}

function StockVignette() {
  const cheesecake = SWEET_HOME_PRODUCTS.find((p) => p.id === "cheesecake");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "hsl(38 92% 55% / 0.08)", border: "0.5px solid hsl(38 92% 55% / 0.25)" }}>
      <AlertTriangle size={13} strokeWidth={1.8} aria-hidden="true" style={{ color: "hsl(38 92% 62%)", flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {cheesecake?.name} · {copy.inventoryView.lowStock}
      </span>
    </div>
  );
}

function RolesVignette() {
  const roles = [t.roleOwner, t.roleManager, t.roleCashier];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {roles.map((role, i) => (
        <span key={role} style={{ ...chipStyle, ...(i === 0 ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" } : {}) }}>
          {role}
        </span>
      ))}
    </div>
  );
}

const CELLS: Array<{ icon: ReactNode; large: boolean; vignette: ReactNode }> = [
  { icon: <CreditCard size={18} strokeWidth={1.6} />, large: true, vignette: <PaymentChips /> },
  { icon: <Package size={18} strokeWidth={1.6} />, large: false, vignette: <StockVignette /> },
  { icon: <Calculator size={18} strokeWidth={1.6} />, large: false, vignette: <CashVignette /> },
  { icon: <BarChart3 size={18} strokeWidth={1.6} />, large: false, vignette: <HoursMiniChart height={34} /> },
  { icon: <WifiOff size={18} strokeWidth={1.6} />, large: true, vignette: <OfflineVignette /> },
  { icon: <UsersRound size={18} strokeWidth={1.6} />, large: false, vignette: <RolesVignette /> },
];

const audienceTypes = copy.landing.builtFor.types.slice(0, 5).map((type) => type.name);

export default function BentoModules() {
  return (
    <section id="como-funciona" className="lp-section" style={{ background: "var(--surface)", borderBottom: "0.5px solid var(--hairline-color)" }}>
      <Reveal className="lp-section-inner" style={{ position: "relative" }}>
        <span id="comercios" style={{ position: "absolute", top: -96 }} aria-hidden="true" />
        <span className="lp-section-label">{t.kicker}</span>
        <h2 className="lp-section-title" style={{ maxWidth: 720 }}>{t.title}</h2>
        <p className="lp-section-copy">{t.body}</p>
        <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {audienceTypes.map((type) => (
            <span key={type} className="lp-chip-lift" style={chipStyle}>
              {type}
            </span>
          ))}
        </div>

        <ul className="lp-bento">
          {t.items.map((item, i) => (
            <li key={item.title} className="lp-bento-cell" data-large={CELLS[i].large ? "1" : "0"}>
              <span aria-hidden="true" style={{ color: "var(--accent)", display: "inline-flex" }}>{CELLS[i].icon}</span>
              <h3 style={{ margin: "10px 0 0", fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", color: "var(--page-fg)" }}>{item.title}</h3>
              <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" }}>{item.line}</p>
              <div style={{ marginTop: "auto", paddingTop: 14 }}>{CELLS[i].vignette}</div>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}

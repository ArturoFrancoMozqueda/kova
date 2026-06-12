// Recreación en miniatura del POS real (register/RegisterView.tsx) con los
// datos demo de Sweet Home. Decorativa pero fiel: misma jerarquía y labels
// que el producto ("Venta actual", "Cobrar", métodos de pago), interactividad
// limitada a armar el ticket. Sin estado de servidor.
import { useState, type CSSProperties } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { formatMoney } from "@/orders/format";
import { copy } from "@/i18n/messages";
import {
  SWEET_HOME_ACTIVE_SALE,
  SWEET_HOME_BUSINESS,
  SWEET_HOME_PRODUCTS,
  SWEET_HOME_SALE_TOTAL,
  type SweetHomeCategoryId,
  type SweetHomeProduct,
} from "@/landing/demo/sweetHome";
import { ProductIcon } from "@/landing/previews/ProductIconSet";
import { useCountUp } from "@/landing/previews/useCountUp";

// Microinteracción de entrada (historia, estado 1): la línea de galleta hace
// pop y el total cuenta desde $130 (la venta sin las 2 galletas) hasta $186.
const ENTRY_POP_PRODUCT_ID = "galleta-avena";
const ENTRY_COUNT_FROM =
  SWEET_HOME_SALE_TOTAL -
  (SWEET_HOME_PRODUCTS.find((p) => p.id === ENTRY_POP_PRODUCT_ID)?.price ?? 0) * 2;

const t = copy.landing.sweetHome;

type CategoryFilter = "all" | SweetHomeCategoryId;
type PaymentMethod = "cash" | "transfer" | "card";

const qtyBtnStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 6,
  border: "0.5px solid var(--hairline-color)",
  background: "var(--surface)",
  fontSize: 12,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "inherit",
  color: "var(--page-fg)",
  padding: 0,
};

function initialCart(): Record<string, number> {
  const cart: Record<string, number> = {};
  for (const line of SWEET_HOME_ACTIVE_SALE.lines) cart[line.productId] = line.qty;
  return cart;
}

export default function SweetHomePOSPreview({
  products = SWEET_HOME_PRODUCTS,
  business = SWEET_HOME_BUSINESS,
  employeeName = SWEET_HOME_ACTIVE_SALE.attendedBy,
  interactive = true,
  animateEntry = false,
}: {
  products?: readonly SweetHomeProduct[];
  business?: typeof SWEET_HOME_BUSINESS;
  employeeName?: string;
  interactive?: boolean;
  animateEntry?: boolean;
}) {
  const [cart, setCart] = useState<Record<string, number>>(initialCart);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const items = Object.entries(cart)
    .map(([id, qty]) => {
      const p = products.find((x) => x.id === id);
      return p ? { ...p, qty } : null;
    })
    .filter((x): x is SweetHomeProduct & { qty: number } => !!x && x.qty > 0);
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const filtered = filter === "all" ? products : products.filter((p) => p.categoryId === filter);

  const countedTotal = useCountUp(SWEET_HOME_SALE_TOTAL, {
    from: ENTRY_COUNT_FROM,
    durationMs: 300,
    delayMs: 280,
    animate: animateEntry,
  });
  const displayTotal = animateEntry && !touched ? countedTotal : total;

  const add = (id: string) => {
    if (!interactive) return;
    setTouched(true);
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    setPulseId(id);
    window.setTimeout(() => setPulseId((cur) => (cur === id ? null : cur)), 280);
  };
  const adj = (id: string, d: number) => {
    setTouched(true);
    setCart((c) => {
      const next = Math.max(0, (c[id] || 0) + d);
      const out = { ...c };
      if (next === 0) delete out[id];
      else out[id] = next;
      return out;
    });
  };

  const categories: Array<{ id: CategoryFilter; label: string }> = [
    { id: "all", label: t.categoryAll },
    { id: "bebidas", label: t.categoryDrinks },
    { id: "reposteria", label: t.categoryBakery },
  ];
  const methods: Array<{ id: PaymentMethod; label: string }> = [
    { id: "cash", label: t.paymentCash },
    { id: "transfer", label: t.paymentTransfer },
    { id: "card", label: t.paymentCard },
  ];

  return (
    <div
      className="lp-pos-preview"
      data-lp-anim={animateEntry ? "on" : "off"}
      style={{
        background: "var(--card-bg)",
        borderRadius: 10,
        border: "0.5px solid var(--hairline-color)",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "1fr 250px",
        color: "var(--page-fg)",
        textAlign: "left",
      }}
    >
      <div className="lp-pos-main" style={{ borderRight: "0.5px solid var(--hairline-color)", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--hairline-color)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <LogoMark size={16} circuitColor="var(--page-fg)" coreColor="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{business.name}</span>
            <span
              style={{
                fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 999,
                background: "var(--chip-bg)", color: "var(--text-muted)", whiteSpace: "nowrap",
              }}
            >
              {employeeName}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            <span className="lp-live-dot" /> {t.online}
          </div>
        </div>

        <div style={{ padding: "8px 16px", display: "flex", gap: 6, borderBottom: "0.5px solid var(--hairline-color)", flexWrap: "wrap" }}>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => interactive && setFilter(c.id)}
              aria-pressed={filter === c.id}
              style={{
                border: "0.5px solid var(--hairline-color)",
                background: filter === c.id ? "var(--invert-ink-bg)" : "var(--surface)",
                color: filter === c.id ? "var(--invert-ink-fg)" : "var(--page-fg)",
                fontSize: 11, padding: "4px 10px", borderRadius: 999, fontWeight: 500,
                fontFamily: "inherit", cursor: interactive ? "pointer" : "default",
                transition: "all 150ms var(--kova-ease-entrance)",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="lp-pos-grid" style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, flex: 1, alignContent: "start" }}>
          {filtered.map((p) => {
            const inCart = (cart[p.id] || 0) > 0;
            const pulsing = pulseId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => add(p.id)}
                aria-label={t.addProduct(p.name)}
                className="lp-product-tile"
                data-active={inCart ? "1" : "0"}
                disabled={!interactive}
                style={{
                  background: "var(--card-bg)",
                  border: "0.5px solid var(--hairline-color)",
                  borderRadius: 10, padding: 10, textAlign: "left",
                  cursor: interactive ? "pointer" : "default", fontFamily: "inherit", color: "inherit",
                  display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
                  transition: "border-color 150ms var(--kova-ease-entrance), transform 150ms var(--kova-ease-entrance), box-shadow 150ms var(--kova-ease-entrance)",
                  transform: pulsing ? "scale(0.97)" : "scale(1)",
                  position: "relative",
                }}
              >
                <ProductIcon iconId={p.iconId} categoryId={p.categoryId} size={18} />
                <span style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.25 }}>{p.name}</span>
                <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", marginTop: "auto" }}>
                  {formatMoney(p.price)}
                </span>
                {inCart && (
                  <span
                    className="tabular lp-cart-count"
                    style={{
                      position: "absolute", top: 6, right: 6,
                      minWidth: 18, height: 18, borderRadius: 999,
                      background: "var(--accent)", color: "#fff",
                      fontSize: 10, fontWeight: 600,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      padding: "0 5px",
                    }}
                  >
                    {cart[p.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lp-pos-ticket" style={{ display: "flex", flexDirection: "column", background: "var(--surface-2)", minWidth: 0 }}>
        <div style={{ padding: "12px 14px 10px", borderBottom: "0.5px solid var(--hairline-color)" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", fontWeight: 500 }}>
            {t.currentSale}
          </div>
          <div style={{ fontSize: 12, marginTop: 2, color: "var(--text-muted)" }}>
            {t.itemCount(items.length)}
          </div>
        </div>
        <ul className="lp-pos-lines" style={{ flex: 1, padding: "4px 14px", overflow: "auto", listStyle: "none", margin: 0 }}>
          {items.length === 0 && (
            <li style={{ fontSize: 12, color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>
              {t.emptyCart}
            </li>
          )}
          {items.map((i) => (
            <li
              key={i.id}
              className={animateEntry && i.id === ENTRY_POP_PRODUCT_ID ? "lp-story-pop" : undefined}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 0", borderBottom: "0.5px solid var(--hairline-color)" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</div>
                <div className="tabular" style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatMoney(i.price)} c/u</div>
              </div>
              {interactive ? (
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button type="button" onClick={() => adj(i.id, -1)} aria-label={`${t.decreaseQuantity} ${i.name}`} style={qtyBtnStyle}>−</button>
                  <span className="tabular" style={{ fontSize: 12, fontWeight: 600, width: 16, textAlign: "center" }}>{i.qty}</span>
                  <button type="button" onClick={() => adj(i.id, 1)} aria-label={`${t.increaseQuantity} ${i.name}`} style={qtyBtnStyle}>+</button>
                </div>
              ) : (
                <span className="tabular" style={{ fontSize: 12, fontWeight: 600 }}>×{i.qty}</span>
              )}
            </li>
          ))}
        </ul>
        <div style={{ padding: "10px 14px 14px", borderTop: "0.5px solid var(--hairline-color)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="lp-pos-methods" role="group" aria-label={t.paymentLegend} style={{ display: "grid", gridTemplateColumns: "1fr 1.45fr 1fr", gap: 4 }}>
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => interactive && setMethod(m.id)}
                aria-pressed={method === m.id}
                style={{
                  border: method === m.id ? "1px solid var(--accent)" : "0.5px solid var(--hairline-color)",
                  background: method === m.id ? "var(--accent-soft)" : "var(--surface)",
                  color: method === m.id ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 10, padding: "6px 2px", borderRadius: 8, fontWeight: 600,
                  fontFamily: "inherit", cursor: interactive ? "pointer" : "default",
                  transition: "all 150ms var(--kova-ease-entrance)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.total}</span>
            <span className="tabular" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>{formatMoney(displayTotal)}</span>
          </div>
          <button
            type="button"
            className="lp-cta-fill lp-charge-pulse"
            disabled={!interactive}
            style={{
              width: "100%", background: "var(--cta-blue, var(--kova-blue))", color: "#fff",
              border: "none", borderRadius: 8, padding: "10px 12px",
              fontSize: 13, fontWeight: 600, cursor: interactive ? "pointer" : "default", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <span>{t.charge(formatMoney(displayTotal))}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

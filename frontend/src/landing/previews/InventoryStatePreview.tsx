// Recreación en miniatura del inventario real (inventory/InventoryView.tsx)
// mostrando el efecto de la venta de $186: los productos vendidos bajan y el
// Cheesecake termina en alerta. Labels importados del producto real.
import { AlertTriangle } from "lucide-react";
import { copy } from "@/i18n/messages";
import { SWEET_HOME_INVENTORY, SWEET_HOME_PRODUCTS } from "@/landing/demo/sweetHome";
import { useCountUp } from "@/landing/previews/useCountUp";

const inv = copy.inventoryView;
const t = copy.landing.sweetHome;

function productName(productId: string): string {
  return SWEET_HOME_PRODUCTS.find((p) => p.id === productId)?.name ?? productId;
}

function StockCard({
  item,
  animate,
  index,
  secondary,
}: {
  item: (typeof SWEET_HOME_INVENTORY.items)[number];
  animate: boolean;
  index: number;
  secondary: boolean;
}) {
  const stock = useCountUp(item.stockAfter, {
    from: item.stockBefore,
    durationMs: 250,
    delayMs: 150 + index * 80,
    animate: animate && item.sold > 0,
  });
  return (
    <div
      className="lp-inv-card"
      data-secondary={secondary ? "1" : "0"}
      style={{
        background: "var(--card-bg)",
        border: "0.5px solid var(--hairline-color)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minWidth: 0,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {productName(item.productId)}
        </span>
        {item.sold > 0 && (
          <span
            className="tabular lp-story-fade"
            style={{
              fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 999,
              background: "rgba(220,38,38,0.12)", color: "#F87171",
              flexShrink: 0,
              ["--lp-fade-delay" as string]: `${360 + index * 80}ms`,
            }}
          >
            −{item.sold}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="tabular" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>{stock}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{inv.onHand}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span className="tabular" style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
          {inv.threshold}: {item.threshold}
        </span>
        {item.low && (
          <span
            className="lp-story-fade"
            style={{
              fontSize: 9.5, fontWeight: 600, padding: "1px 7px", borderRadius: 999,
              background: "hsl(38 92% 55% / 0.14)", color: "hsl(38 92% 62%)",
              whiteSpace: "nowrap",
              ["--lp-fade-delay" as string]: "520ms",
            }}
          >
            {inv.lowStock}
          </span>
        )}
      </div>
    </div>
  );
}

export default function InventoryStatePreview({ animate = true }: { animate?: boolean }) {
  const items = SWEET_HOME_INVENTORY.items.slice(0, 3);
  const alertName = productName(SWEET_HOME_INVENTORY.alertProductId);
  return (
    <div
      className="lp-inv-preview"
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
        <span style={{ fontSize: 13, fontWeight: 600 }}>{inv.title}</span>
        <span
          className="lp-story-fade"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 10.5, fontWeight: 600, padding: "2px 9px", borderRadius: 999,
            background: "hsl(38 92% 55% / 0.14)", color: "hsl(38 92% 62%)",
            ["--lp-fade-delay" as string]: "520ms",
          }}
        >
          <AlertTriangle size={11} strokeWidth={2} aria-hidden="true" />
          {t.lowStockCount(SWEET_HOME_INVENTORY.lowStockCount)}
        </span>
      </div>

      <div className="lp-inv-grid" style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {items.map((item, i) => (
          <StockCard key={item.productId} item={item} animate={animate} index={i} secondary={item.sold === 0} />
        ))}
      </div>

      <div style={{ padding: "0 14px 14px" }}>
        <div
          className="lp-story-fade"
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 10,
            background: "hsl(38 92% 55% / 0.08)",
            border: "0.5px solid hsl(38 92% 55% / 0.25)",
            ["--lp-fade-delay" as string]: "640ms",
          }}
        >
          <AlertTriangle size={15} strokeWidth={1.8} aria-hidden="true" style={{ color: "hsl(38 92% 62%)", flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {alertName} · {inv.stockVelocity}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{inv.reorderSuggestion}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

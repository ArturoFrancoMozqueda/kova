import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";
import { listOrders } from "./api";
import { formatMoney } from "./format";
import type { OrderListItem } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; items: OrderListItem[]; total: number };

export default function OrderListView() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const result = await listOrders();
      setLoadState({ status: "loaded", items: result.items, total: result.total });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState.status === "loading") {
    return <main aria-busy="true">{copy.orderList.loading}</main>;
  }

  if (loadState.status === "error") {
    return (
      <main>
        <p role="alert">{copy.orderList.loadError}</p>
        <button type="button" onClick={() => void load()}>
          {copy.orderList.retry}
        </button>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{copy.app.dashboard}</p>
          <h1>{copy.orderList.title}</h1>
        </div>
        <p className="muted">{loadState.total} {copy.orderList.total}</p>
      </header>

      {loadState.items.length === 0 ? (
        <section className="panel">
          <p>{copy.orderList.empty}</p>
        </section>
      ) : (
        <section className="panel">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #d8d0c2" }}>
                  <th style={{ textAlign: "left", padding: "0.75rem", fontWeight: 600 }}>{copy.orderList.date}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem", fontWeight: 600 }}>{copy.orderList.status}</th>
                  <th style={{ textAlign: "right", padding: "0.75rem", fontWeight: 600 }}>{copy.orderList.amount}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem", fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {loadState.items.map((order) => (
                  <tr key={order.id} style={{ borderBottom: "1px solid #e8e1d6" }}>
                    <td style={{ padding: "0.75rem" }}>
                      {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at))}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <span className={order.status === "voided" ? "status-warn" : "notice"}>
                        {order.status}
                      </span>
                    </td>
                    <td style={{ padding: "0.75rem", textAlign: "right" }}>
                      <strong>{formatMoney(order.total_amount)}</strong>
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <Link to={`/orders/${order.id}`}>{copy.orderList.view}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

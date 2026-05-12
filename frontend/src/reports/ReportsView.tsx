import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  REPORTS_VIEW_ALL_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import { formatMoney, reasonLabel } from "../orders/format";
import { getPaymentBreakdown, getSalesSummary, getTopProducts } from "./api";
import type { PaymentBreakdown, SalesSummary, TopProducts } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "loaded";
      summary: SalesSummary;
      payments: PaymentBreakdown;
      products: TopProducts;
    };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportsView() {
  const canViewReports = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(today());
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!canViewReports) {
      setLoadState({ status: "error" });
      return;
    }
    setLoadState({ status: "loading" });
    try {
      const [summary, payments, products] = await Promise.all([
        getSalesSummary(startDate, endDate),
        getPaymentBreakdown(startDate, endDate),
        getTopProducts(startDate, endDate),
      ]);
      setLoadState({ status: "loaded", summary, payments, products });
    } catch {
      setLoadState({ status: "error" });
    }
  }, [canViewReports, endDate, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  if (!canViewReports) {
    return (
      <main className="page">
        <h1>{copy.reportsView.title}</h1>
        <p className="muted">{copy.reportsView.permissionHidden}</p>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{copy.app.dashboard}</p>
          <h1>{copy.reportsView.title}</h1>
        </div>
        <form className="date-filter" onSubmit={submit}>
          <label>
            {copy.reportsView.startDate}
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </label>
          <label>
            {copy.reportsView.endDate}
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          <button type="submit">{copy.reportsView.apply}</button>
        </form>
      </header>
      {loadState.status === "loading" ? <p aria-busy="true">{copy.reportsView.loading}</p> : null}
      {loadState.status === "error" ? (
        <section className="panel">
          <p role="alert">{copy.reportsView.loadError}</p>
          <button type="button" onClick={() => void load()}>
            {copy.reportsView.retry}
          </button>
        </section>
      ) : null}
      {loadState.status === "loaded" ? (
        <>
          <section className="data-grid" aria-label={copy.reportsView.title}>
            <Metric label={copy.reportsView.grossSales} value={formatMoney(loadState.summary.gross_sales)} />
            <Metric label={copy.reportsView.refunds} value={formatMoney(loadState.summary.refund_total)} />
            <Metric label={copy.reportsView.netSales} value={formatMoney(loadState.summary.net_sales)} />
            <Metric label={copy.reportsView.orders} value={String(loadState.summary.order_count)} />
            <Metric label={copy.reportsView.voids} value={String(loadState.summary.void_count)} />
          </section>
          <section className="panel" aria-labelledby="payment-breakdown-title">
            <h2 id="payment-breakdown-title">{copy.reportsView.paymentBreakdown}</h2>
            {loadState.payments.payments.length === 0 ? <p>{copy.reportsView.noPayments}</p> : null}
            <div className="data-grid">
              {loadState.payments.payments.map((payment) => (
                <article className="data-card" key={payment.method}>
                  <h3>{reasonLabel(payment.method)}</h3>
                  <strong>{formatMoney(payment.amount)}</strong>
                  <p>{payment.payment_count}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="panel" aria-labelledby="top-products-title">
            <h2 id="top-products-title">{copy.reportsView.topProducts}</h2>
            {loadState.products.products.length === 0 ? <p>{copy.reportsView.noProducts}</p> : null}
            <div className="data-grid">
              {loadState.products.products.map((product) => (
                <article className="data-card" key={product.product_id}>
                  <h3>{product.product_name}</h3>
                  <strong>{product.quantity_sold}</strong>
                  <p>{formatMoney(product.gross_sales)}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="data-card">
      <p className="muted">{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

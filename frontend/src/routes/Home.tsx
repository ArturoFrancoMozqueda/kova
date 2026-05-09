import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";

export default function Home() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">{copy.app.offlineShell}</p>
        <h1>{copy.app.homeTitle}</h1>
        <p aria-label="offline queue status">{copy.app.offlineReady}</p>
      </header>
      <section className="data-grid" aria-label={copy.app.dashboard}>
        <Link className="data-card link-card" to="/inventory?permissions=inventory.adjust">
          <h2>{copy.app.inventory}</h2>
          <p>{copy.app.inventorySummary}</p>
        </Link>
        <Link className="data-card link-card" to="/shifts?permissions=shifts.open,shifts.close">
          <h2>{copy.app.shifts}</h2>
          <p>{copy.app.shiftsSummary}</p>
        </Link>
        <Link className="data-card link-card" to="/orders/demo?permissions=orders.refund,orders.void">
          <h2>{copy.app.orders}</h2>
          <p>{copy.app.ordersSummary}</p>
        </Link>
      </section>
    </main>
  );
}

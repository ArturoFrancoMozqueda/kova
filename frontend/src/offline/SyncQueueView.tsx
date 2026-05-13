import { copy } from "../i18n/messages";
import { useIsOnline, useSyncQueue } from "./useSyncQueue";

export default function SyncQueueView() {
  const isOnline = useIsOnline();
  const { pendingCount, failedEntries, syncNow, retryDeadLetter } = useSyncQueue();

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>{copy.syncQueue.title}</h1>
        </div>
        {isOnline && pendingCount > 0 && (
          <button type="button" onClick={() => void syncNow()}>
            {copy.syncQueue.syncNow}
          </button>
        )}
      </header>

      {pendingCount === 0 && failedEntries.length === 0 ? (
        <p className="muted">{copy.syncQueue.empty}</p>
      ) : null}

      {pendingCount > 0 && (
        <section className="panel">
          <h2>{copy.syncQueue.pending}</h2>
          <p aria-busy="true">
            {copy.register.pendingSales(pendingCount)}
            {!isOnline ? ` — ${copy.register.offline}` : ""}
          </p>
        </section>
      )}

      {failedEntries.length > 0 && (
        <section className="panel">
          <h2>{copy.syncQueue.failed}</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {failedEntries.map((entry) => (
              <li
                key={entry.client_uuid}
                className="data-card"
                style={{ marginBottom: "1rem" }}
              >
                <div>
                  <p className="eyebrow">
                    {new Date(entry.updated_at).toLocaleString()}
                  </p>
                  <p className="muted">
                    {copy.syncQueue.attemptCount(entry.attempt_count)}
                  </p>
                  {entry.last_error && (
                    <p className="status-warn" style={{ marginTop: "0.25rem" }}>
                      {copy.syncQueue.lastError}: {entry.last_error}
                    </p>
                  )}
                  <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                    {entry.sale.items
                      .map((i) => `${i.quantity}×${i.product_id.slice(0, 8)}`)
                      .join(", ")}
                    {" — "}
                    {entry.sale.payments.map((p) => `${p.method}:${p.amount}`).join(" + ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void retryDeadLetter(entry.client_uuid).then(() => void syncNow())
                  }
                >
                  {copy.syncQueue.retry}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

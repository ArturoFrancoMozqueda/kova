import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  SHIFT_CLOSE_PERMISSION,
  SHIFT_OPEN_PERMISSION,
  permissionsFromSearch,
} from "../auth/permissions";
import { copy } from "../i18n/messages";
import {
  closeShift,
  getOpenShift,
  listClosedShifts,
  openShift,
  recordCashMovement,
} from "./api";
import { CashMovementModal } from "./CashMovementModal";
import { CloseShiftModal } from "./CloseShiftModal";
import { OpenShiftModal } from "./OpenShiftModal";
import type { CashMovementPayload, Shift, ShiftClosePayload, ShiftOpenPayload } from "./types";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; openShift: Shift | null; closedShifts: Shift[] };

type ActiveModal = null | "open" | "close" | "movement";

export default function ShiftView() {
  const location = useLocation();
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const permissions = useMemo(() => permissionsFromSearch(location.search), [location.search]);

  const canOpen = permissions.has(SHIFT_OPEN_PERMISSION);
  const canClose = permissions.has(SHIFT_CLOSE_PERMISSION);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      let openShiftData: Shift | null = null;
      try {
        openShiftData = await getOpenShift();
      } catch (e) {
        if (e instanceof Error && "status" in e && e.status === 404) {
          openShiftData = null;
        } else {
          throw e;
        }
      }
      const closedShifts = await listClosedShifts();
      setLoadState({ status: "loaded", openShift: openShiftData, closedShifts });
    } catch {
      setLoadState({ status: "error", message: copy.shiftView.loadError });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitOpenShift = async (payload: ShiftOpenPayload) => {
    setOperationPending(true);
    setNotice(null);
    try {
      await openShift(payload);
      setActiveModal(null);
      setNotice(copy.shiftView.openSuccess);
      await load();
    } catch {
      setNotice(copy.shiftView.operationError);
    } finally {
      setOperationPending(false);
    }
  };

  const submitCloseShift = async (payload: ShiftClosePayload) => {
    if (loadState.status !== "loaded" || !loadState.openShift) {
      return;
    }
    setOperationPending(true);
    setNotice(null);
    try {
      await closeShift(loadState.openShift.id, payload);
      setActiveModal(null);
      setNotice(copy.shiftView.closeSuccess);
      await load();
    } catch {
      setNotice(copy.shiftView.operationError);
    } finally {
      setOperationPending(false);
    }
  };

  const submitCashMovement = async (payload: CashMovementPayload) => {
    if (loadState.status !== "loaded" || !loadState.openShift) {
      return;
    }
    setOperationPending(true);
    setNotice(null);
    try {
      await recordCashMovement(loadState.openShift.id, payload);
      setActiveModal(null);
      setNotice(copy.shiftView.movementSuccess);
      await load();
    } catch {
      setNotice(copy.shiftView.operationError);
    } finally {
      setOperationPending(false);
    }
  };

  if (loadState.status === "loading") {
    return <main aria-busy="true">{copy.shiftView.loading}</main>;
  }

  if (loadState.status === "error") {
    return (
      <main className="page">
        <p role="alert">{loadState.message}</p>
        <button type="button" onClick={() => void load()}>
          {copy.shiftView.retry}
        </button>
      </main>
    );
  }

  const { openShift: currentShift, closedShifts } = loadState;

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{copy.app.dashboard}</p>
          <h1>{copy.shiftView.title}</h1>
        </div>
      </header>

      {notice && <p role="status" className="notice">{notice}</p>}

      {currentShift ? (
        <section className="panel">
          <h2>{copy.shiftView.activeShift}</h2>
          <article className="data-card">
            <div>
              <p className="eyebrow">{copy.shiftView.openedAt}</p>
              <p>{new Date(currentShift.opened_at).toLocaleString()}</p>
            </div>
            {currentShift.opening_cash_amount && (
              <div>
                <p className="eyebrow">{copy.shiftView.openingCash}</p>
                <strong>${parseFloat(currentShift.opening_cash_amount).toFixed(2)}</strong>
              </div>
            )}
            <div>
              <h3>{copy.shiftView.movements}</h3>
              {currentShift.movements.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
                  {currentShift.movements.map((m) => (
                    <li key={m.id} style={{ marginBlock: "0.5rem" }}>
                      <span className="eyebrow">{m.type}</span>
                      <strong>${parseFloat(m.amount).toFixed(2)}</strong>
                      <p style={{ margin: "0.25rem 0 0" }} className="muted">{m.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{copy.shiftView.noMovements}</p>
              )}
            </div>
            <div className="button-row">
              {canOpen && (
                <button type="button" onClick={() => setActiveModal("movement")}>
                  {copy.shiftView.recordMovement}
                </button>
              )}
              {canClose && (
                <button type="button" onClick={() => setActiveModal("close")}>
                  {copy.shiftView.closeShift}
                </button>
              )}
            </div>
          </article>
        </section>
      ) : (
        <section className="panel">
          <h2>{copy.shiftView.noOpenShift}</h2>
          {canOpen && (
            <button type="button" onClick={() => setActiveModal("open")}>
              {copy.shiftView.openShift}
            </button>
          )}
        </section>
      )}

      {closedShifts.length > 0 && (
        <section className="panel">
          <h2>{copy.shiftView.closedShifts}</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #d8d0c2" }}>
                  <th style={{ textAlign: "left", padding: "0.75rem", fontWeight: 600 }}>{copy.shiftView.openedAt}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem", fontWeight: 600 }}>{copy.shiftView.closedAt}</th>
                  <th style={{ textAlign: "left", padding: "0.75rem", fontWeight: 600 }}>{copy.shiftView.status}</th>
                </tr>
              </thead>
              <tbody>
                {closedShifts.slice(0, 10).map((shift) => (
                  <tr key={shift.id} style={{ borderBottom: "1px solid #e8e1d6" }}>
                    <td style={{ padding: "0.75rem" }}>{new Date(shift.opened_at).toLocaleString()}</td>
                    <td style={{ padding: "0.75rem" }}>{shift.closed_at ? new Date(shift.closed_at).toLocaleString() : "-"}</td>
                    <td style={{ padding: "0.75rem" }}>
                      {shift.reconciliation_status ? (
                        <span className={shift.reconciliation_status === "balanced" ? "notice" : "status-warn"}>
                          {shift.reconciliation_status}
                        </span>
                      ) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeModal === "open" && (
        <OpenShiftModal
          pending={operationPending}
          onSubmit={submitOpenShift}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "close" && currentShift && (
        <CloseShiftModal
          shift={currentShift}
          pending={operationPending}
          onSubmit={submitCloseShift}
          onCancel={() => setActiveModal(null)}
        />
      )}
      {activeModal === "movement" && (
        <CashMovementModal
          pending={operationPending}
          onSubmit={submitCashMovement}
          onCancel={() => setActiveModal(null)}
        />
      )}
    </main>
  );
}

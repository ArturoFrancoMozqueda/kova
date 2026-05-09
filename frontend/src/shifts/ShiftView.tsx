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
      <main>
        <p role="alert">{loadState.message}</p>
        <button type="button" onClick={() => void load()}>
          {copy.shiftView.retry}
        </button>
      </main>
    );
  }

  const { openShift: currentShift, closedShifts } = loadState;

  return (
    <main>
      <h1>{copy.shiftView.title}</h1>

      {notice && <p role="status">{notice}</p>}

      {currentShift ? (
        <article>
          <h2>{copy.shiftView.activeShift}</h2>
          <p>
            <strong>{copy.shiftView.openedAt}:</strong> {new Date(currentShift.opened_at).toLocaleString()}
          </p>
          {currentShift.opening_cash_amount && (
            <p>
              <strong>{copy.shiftView.openingCash}:</strong> ${parseFloat(currentShift.opening_cash_amount).toFixed(2)}
            </p>
          )}
          <div style={{ marginTop: "1rem" }}>
            <h3>{copy.shiftView.movements}</h3>
            {currentShift.movements.length > 0 ? (
              <ul>
                {currentShift.movements.map((m) => (
                  <li key={m.id}>
                    <strong>{m.type}:</strong> ${parseFloat(m.amount).toFixed(2)} - {m.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{copy.shiftView.noMovements}</p>
            )}
          </div>
          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
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
      ) : (
        <article>
          <h2>{copy.shiftView.noOpenShift}</h2>
          {canOpen && (
            <button type="button" onClick={() => setActiveModal("open")}>
              {copy.shiftView.openShift}
            </button>
          )}
        </article>
      )}

      {closedShifts.length > 0 && (
        <article>
          <h2>{copy.shiftView.closedShifts}</h2>
          <table>
            <thead>
              <tr>
                <th>{copy.shiftView.openedAt}</th>
                <th>{copy.shiftView.closedAt}</th>
                <th>{copy.shiftView.status}</th>
              </tr>
            </thead>
            <tbody>
              {closedShifts.slice(0, 10).map((shift) => (
                <tr key={shift.id}>
                  <td>{new Date(shift.opened_at).toLocaleString()}</td>
                  <td>{shift.closed_at ? new Date(shift.closed_at).toLocaleString() : "-"}</td>
                  <td>{shift.reconciliation_status || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
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

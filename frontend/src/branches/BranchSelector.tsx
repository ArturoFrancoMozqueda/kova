import { useEffect, useId, useState } from "react";
import { useAuth } from "@/auth/useAuth";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getActiveBranchId, saveActiveBranchId } from "./activeBranch";
import { listBranches, type Branch } from "./api";

export function BranchSelector() {
  const { state } = useAuth();
  const id = useId();
  const tenantId = state.status === "authenticated" ? state.tenantId : "";
  const userId = state.status === "authenticated" ? state.user.id : "";
  const offline =
    state.status === "authenticated" && state.sessionMode === "offline";
  const active = getActiveBranchId(tenantId, userId);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!tenantId || offline) return;
    let alive = true;
    listBranches(tenantId)
      .then((rows) => {
        if (alive) {
          setBranches(rows);
          setError("");
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setError("No pudimos cargar las sucursales.");
      });
    return () => {
      alive = false;
    };
  }, [tenantId, offline, attempt]);
  useEffect(() => {
    const update = () => setAttempt((value) => value + 1);
    window.addEventListener("kova-branches-updated", update);
    return () => window.removeEventListener("kova-branches-updated", update);
  }, []);
  if (!tenantId) return null;
  // A single-location business has nothing to choose: the bar only cost a full
  // row (two on a phone) above every view. Online, it stays hidden until the
  // list resolves so it never flashes in and shoves the page down; offline it
  // still renders (disabled) because the list can't be checked.
  const nothingToChoose = !offline && !error && (!loaded || (branches.length <= 1 && branches.every((branch) => branch.id === active)));
  if (nothingToChoose) return null;
  const change = () => {
    if (!pending || offline || !navigator.onLine) return;
    try {
      saveActiveBranchId(tenantId, userId, pending);
      // A full remount prevents carts, open drawers and in-flight cached reads
      // from surviving a change in operating location. Queued sales keep origin.
      window.location.reload();
    } catch {
      setError("No pudimos cambiar de sucursal en este dispositivo.");
      setPending(null);
    }
  };
  return (
    <section aria-label="Selección de sucursal" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-4 py-2.5">
      <label htmlFor={id} className="shrink-0 text-sm font-medium">
        Sucursal activa
      </label>
      <Select
        id={id}
        value={active}
        disabled={offline || branches.length === 0}
        className="h-10 min-w-0 flex-1 sm:max-w-xs sm:flex-none"
        onChange={(event) => setPending(event.target.value)}
      >
        {!branches.some((branch) => branch.id === active) ? (
          <option value={active}>
            {active === tenantId
              ? "Sucursal principal"
              : "Sucursal seleccionada"}
          </option>
        ) : null}
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </Select>
      {offline ? (
        <p className="text-xs text-muted-foreground">
          Conéctate para cambiar de sucursal.
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          <span>{error}</span>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Reintentar
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        title="Cambiar de sucursal"
        description="Se vaciará el carrito y se descartarán los cambios que no hayas guardado en esta vista. Las ventas registradas y pendientes de sincronizar se conservan en su sucursal de origen."
        confirmLabel="Cambiar sucursal"
        destructive={false}
        onConfirm={change}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

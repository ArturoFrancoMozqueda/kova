import { type FormEvent, useEffect, useId, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeeBranchAccess } from "./EmployeeBranchAccess";
import { InventoryTransfers } from "./InventoryTransfers";
import { listBranches, saveBranch, type Branch } from "./api";

export function BranchesSettings() {
  const id = useId();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    listBranches()
      .then((rows) => {
        if (alive) {
          setBranches(rows);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (alive)
          setError(
            err instanceof Error
              ? err.message
              : "No pudimos cargar las sucursales.",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const reset = () => {
    setEditing(null);
    setName("");
    setAddress("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const branch = await saveBranch(name, address, editing?.id);
      setBranches((rows) =>
        editing
          ? rows.map((row) => (row.id === branch.id ? branch : row))
          : [...rows, branch],
      );
      reset();
      // Selector lives outside the route; refresh its discovery after a saved change.
      window.dispatchEvent(new Event("kova-branches-updated"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No pudimos guardar la sucursal.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Sucursales</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cada sucursal tiene sus propias ventas, existencias y caja.
            Comparten catálogo, empleados y suscripción.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? <p role="status">Cargando sucursales…</p> : null}
          {error ? (
            <div role="alert">
              <p className="text-destructive">{error}</p>
              <Button
                variant="outline"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Reintentar carga
              </Button>
            </div>
          ) : null}
          <ul className="divide-y">
            {branches.map((branch) => (
              <li
                key={branch.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 break-words">
                  <p className="font-medium">{branch.name}</p>
                  {branch.address ? (
                    <p className="text-sm text-muted-foreground">
                      {branch.address}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`Editar ${branch.name}`}
                  onClick={() => {
                    setEditing(branch);
                    setName(branch.name);
                    setAddress(branch.address ?? "");
                  }}
                >
                  Editar
                </Button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => void submit(event)}
            className="grid max-w-xl gap-4"
          >
            <h3 className="font-medium">
              {editing ? "Editar sucursal" : "Agregar sucursal"}
            </h3>
            <div className="space-y-1">
              <Label htmlFor={`${id}-name`}>Nombre de la sucursal</Label>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                required
                disabled={busy}
                placeholder="Ej. Centro"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-address`}>Dirección (opcional)</Label>
              <Input
                id={`${id}-address`}
                value={address}
                maxLength={300}
                disabled={busy}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || loading || !name.trim()}>
                {busy
                  ? "Guardando…"
                  : editing
                    ? "Guardar cambios"
                    : "Crear sucursal"}
              </Button>
              {editing ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={reset}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
      <EmployeeBranchAccess />
      <InventoryTransfers />
    </>
  );
}

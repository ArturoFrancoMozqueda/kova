import { useEffect, useState } from "react";
import { useAuth } from "@/auth/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { listEmployees, type Employee } from "@/settings/api";
import { csrfHeaders } from "@/lib/csrf";
import { listBranches, type Branch } from "./api";

export function EmployeeBranchAccess() {
  const { state } = useAuth();
  const owner = state.status === "authenticated" && state.user.role === "owner";
  const [employees, setEmployees] = useState<
    (Employee & { allowed_branch_id?: string | null })[]
  >([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    Promise.all([listEmployees(), listBranches()])
      .then(([rows, locations]) => {
        if (alive) {
          setEmployees(rows);
          setBranches(locations);
        }
      })
      .catch(() => {
        if (alive) setError("No pudimos cargar los accesos por sucursal.");
      });
    return () => {
      alive = false;
    };
  }, [owner]);
  const update = async (employee: Employee, branch: string) => {
    setBusy(employee.membership_id);
    setError("");
    setSaved("");
    try {
      const response = await fetch(
        `/api/v1/employees/${employee.membership_id}/branch`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...csrfHeaders("PATCH"),
          },
          body: JSON.stringify({ allowed_branch_id: branch || null }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(body.detail ?? "No pudimos guardar el acceso.");
      }
      const updated = (await response.json()) as Employee & {
        allowed_branch_id: string | null;
      };
      setEmployees((rows) =>
        rows.map((row) =>
          row.membership_id === updated.membership_id ? updated : row,
        ),
      );
      setSaved("Acceso por sucursal actualizado.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No pudimos guardar el acceso.",
      );
    } finally {
      setBusy("");
    }
  };
  if (!owner) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Acceso de empleados por sucursal</CardTitle>
        <p className="text-sm text-muted-foreground">
          Asigna una sucursal o permite operar en todas. Los propietarios
          conservan acceso a todo el negocio.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {saved && <p role="status">{saved}</p>}
        {employees
          .filter((row) => row.is_active && row.role !== "owner")
          .map((row) => (
            <div key={row.membership_id} className="grid gap-2">
              <Label htmlFor={`employee-branch-${row.membership_id}`}>
                {row.email}
              </Label>
              <Select
                id={`employee-branch-${row.membership_id}`}
                value={row.allowed_branch_id ?? ""}
                disabled={!!busy}
                onChange={(event) => void update(row, event.target.value)}
              >
                <option value="">Todas las sucursales</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        {employees.every((row) => !row.is_active || row.role === "owner") && (
          <p className="text-sm text-muted-foreground">
            Invita empleados desde Configuración → Empleados para asignarles una
            sucursal.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

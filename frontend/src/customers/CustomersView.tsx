import { useEffect, useState, type FormEvent } from "react";
import {
  usePermission,
  CUSTOMERS_MANAGE_PERMISSION,
  CUSTOMERS_HISTORY_PERMISSION,
} from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewLayout } from "@/components/ui/view-layout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  customerHistory,
  listCustomers,
  saveCustomer,
  type Customer,
  type CustomerHistory,
} from "./api";

const money = (amount: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(amount),
  );
export function CustomersView() {
  useDocumentTitle("Clientes");
  const canManage = usePermission(CUSTOMERS_MANAGE_PERMISSION);
  const canHistory = usePermission(CUSTOMERS_HISTORY_PERMISSION);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [inactive, setInactive] = useState(false);
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Customer | null | undefined>(
    undefined,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void listCustomers(q, offset, inactive)
        .then((data) => {
          if (active) {
            setRows(data);
            setError("");
          }
        })
        .catch((e: unknown) => {
          if (active)
            setError(
              e instanceof Error
                ? e.message
                : "No pudimos cargar los clientes.",
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, offset, inactive, revision]);
  const edit = (customer: Customer | null) => {
    setEditing(customer);
    setName(customer?.name ?? "");
    setEmail(customer?.email ?? "");
    setPhone(customer?.phone ?? "");
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await saveCustomer(
        {
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          is_active: editing?.is_active ?? true,
        },
        editing?.id,
      );
      setEditing(undefined);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar el cliente.",
      );
    } finally {
      setSaving(false);
    }
  };
  const showHistory = async (id: string, historyOffset = 0) => {
    setHistoryLoading(true);
    setError("");
    try {
      setHistory(await customerHistory(id, historyOffset));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos cargar el historial.",
      );
    } finally {
      setHistoryLoading(false);
    }
  };
  const toggleActive = async (customer: Customer) => {
    setSaving(true);
    try {
      await saveCustomer(
        {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          is_active: !customer.is_active,
        },
        customer.id,
      );
      setRevision((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos actualizar el cliente.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <ViewLayout className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-muted-foreground">
            Identifica a tus clientes y consulta sus compras registradas.
          </p>
        </div>
        {canManage && <Button onClick={() => edit(null)}>Nuevo cliente</Button>}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {editing !== undefined && canManage && (
        <form
          onSubmit={(e) => void submit(e)}
          className="rounded-xl border bg-card p-5 space-y-4"
          aria-label="Formulario de cliente"
        >
          <h2 className="font-semibold">
            {editing ? "Editar cliente" : "Nuevo cliente"}
          </h2>
          <div>
            <Label htmlFor="customer-name">Nombre</Label>
            <Input
              id="customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={160}
            />
          </div>
          <div>
            <Label htmlFor="customer-email">Correo (opcional)</Label>
            <Input
              id="customer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
          </div>
          <div>
            <Label htmlFor="customer-phone">Teléfono (opcional)</Label>
            <Input
              id="customer-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              pattern="[+0-9 ()-]+"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Registra únicamente los datos que el cliente comparta para sus
            compras.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Guardando…" : "Guardar cliente"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setEditing(undefined)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Buscar clientes"
          placeholder="Buscar por nombre, correo o teléfono"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          className="max-w-md"
        />
        <Label className="flex gap-2 items-center">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => {
              setInactive(e.target.checked);
              setOffset(0);
            }}
          />
          Incluir inactivos
        </Label>
      </div>
      {loading ? (
        <p role="status">Cargando clientes…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border p-8 text-muted-foreground">
          {q
            ? "No encontramos clientes con esa búsqueda."
            : "Todavía no hay clientes registrados."}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((customer) => (
            <li
              key={customer.id}
              className="flex flex-wrap justify-between gap-3 p-4"
            >
              <div>
                <p className="font-medium">
                  {customer.name}
                  {!customer.is_active && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Inactivo
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[customer.email, customer.phone]
                    .filter(Boolean)
                    .join(" · ") || "Sin datos de contacto"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canHistory && (
                  <Button
                    variant="outline"
                    disabled={historyLoading}
                    onClick={() => void showHistory(customer.id)}
                  >
                    Ver compras
                  </Button>
                )}
                {canManage && (
                  <>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => edit(customer)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() => void toggleActive(customer)}
                    >
                      {customer.is_active ? "Desactivar" : "Reactivar"}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0 || loading}
          onClick={() => setOffset((n) => Math.max(0, n - 100))}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          disabled={rows.length < 100 || loading}
          onClick={() => setOffset((n) => n + 100)}
        >
          Siguiente
        </Button>
      </div>
      {history && (
        <section
          className="rounded-xl border bg-card p-5 space-y-3"
          aria-label="Historial de compras"
        >
          <div className="flex justify-between gap-3">
            <h2 className="font-semibold">
              Compras de {history.customer.name}
            </h2>
            <Button variant="ghost" onClick={() => setHistory(null)}>
              Cerrar
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Ventas asociadas al cliente en la sucursal seleccionada. Las
            devoluciones se muestran por separado.
          </p>
          {history.purchases.length === 0 ? (
            <p>Este cliente todavía no tiene compras registradas.</p>
          ) : (
            <ul className="divide-y">
              {history.purchases.map((sale) => (
                <li key={sale.id} className="py-3 flex justify-between gap-3">
                  <div>
                    <p>{new Date(sale.occurred_at).toLocaleString("es-MX")}</p>
                    <p className="text-xs text-muted-foreground">
                      {sale.status === "voided"
                        ? "Venta anulada"
                        : "Venta completada"}{" "}
                      · {sale.id.slice(0, 8)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p>{money(sale.total_amount)}</p>
                    {Number(sale.refunded_amount) > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Devuelto: {money(sale.refunded_amount)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={history.offset === 0 || historyLoading}
              onClick={() =>
                void showHistory(
                  history.customer.id,
                  Math.max(0, history.offset - history.limit),
                )
              }
            >
              Compras anteriores
            </Button>
            <Button
              variant="outline"
              disabled={!history.has_more || historyLoading}
              onClick={() =>
                void showHistory(
                  history.customer.id,
                  history.offset + history.limit,
                )
              }
            >
              Más compras
            </Button>
          </div>
        </section>
      )}
    </ViewLayout>
  );
}

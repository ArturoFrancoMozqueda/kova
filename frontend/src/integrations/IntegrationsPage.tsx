import { useEffect, useState } from "react";
import { useAuthContext } from "@/auth/AuthContext";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { listOrders } from "@/orders/api";
import { formatDateTime, formatMoney } from "@/orders/format";
import type { OrderListItem } from "@/orders/types";
import {
  createInvoiceRequest,
  getReadiness,
  listInvoiceRequests,
  saveIssuer,
  type FiscalIdentity,
  type InvoiceRecipient,
  type InvoiceRequest,
} from "./api";

const emptyIdentity: FiscalIdentity = {
  rfc: "",
  legal_name: "",
  postal_code: "",
  tax_regime: "",
};
const labels: Record<keyof FiscalIdentity, string> = {
  rfc: "RFC",
  legal_name: "Nombre o razón social",
  postal_code: "Código postal fiscal",
  tax_regime: "Clave de régimen fiscal",
};
const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2";
function IdentityFields({
  value,
  onChange,
}: {
  value: FiscalIdentity;
  onChange: (value: FiscalIdentity) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(Object.keys(labels) as (keyof FiscalIdentity)[]).map((field) => (
        <label key={field} className="text-sm">
          {labels[field]}
          <input
            required
            className={inputClass}
            value={value[field]}
            onChange={(e) => onChange({ ...value, [field]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

export function IntegrationContents({
  canManage = false,
}: {
  canManage?: boolean;
}) {
  const [issuer, setIssuer] = useState<FiscalIdentity>(emptyIdentity);
  const [saved, setSaved] = useState(false);
  const [recipient, setRecipient] = useState<InvoiceRecipient>({
    ...emptyIdentity,
    cfdi_use: "",
    email: "",
  });
  const [orderId, setOrderId] = useState("");
  const [sales, setSales] = useState<OrderListItem[]>([]);
  const [requests, setRequests] = useState<InvoiceRequest[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Keep the same key after a network failure so retry cannot create a second request.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    Promise.all([
      getReadiness(),
      canManage ? listInvoiceRequests() : Promise.resolve([]),
      canManage
        ? listOrders({ status: "completed", limit: 100 })
        : Promise.resolve({ items: [] }),
    ])
      .then(([state, items, orders]) => {
        if (active) {
          setIssuer(state.issuer ?? emptyIdentity);
          setSaved(!!state.issuer);
          setRequests(items);
          setSales(orders.items);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canManage]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ViewLayout width="focused" className="space-y-6">
      <ViewHeader
        title="Facturación e integraciones"
        meta="Prepara los datos de tu negocio y registra solicitudes de factura."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-border p-5">
          <h2 className="font-semibold">Facturación CFDI · Sin conectar</h2>
          <p className="mt-2 text-sm">
            Un PAC es la empresa autorizada por el SAT que certifica las
            facturas. Kova necesita una integración contratada para emitirlas.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Las solicitudes guardadas aquí quedan pendientes. No generan un CFDI
            ni un folio fiscal.
          </p>
        </section>
        <section className="rounded-2xl border border-border p-5">
          <h2 className="font-semibold">Terminal bancaria · Sin conectar</h2>
          <p className="mt-2 text-sm">
            Para cobrar desde Kova se requiere un proveedor y una terminal
            compatibles. Registrar tarjeta en una venta solo registra el método
            de pago.
          </p>
        </section>
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p role="status">Cargando datos fiscales…</p>
      ) : (
        <>
          <section className="rounded-2xl border border-border p-5">
            <h2 className="mb-3 font-semibold">Datos fiscales del negocio</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Se revisa el formato de los datos. No se consulta ni valida tu
              situación ante el SAT.
            </p>
            {canManage ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await saveIssuer(issuer);
                    setSaved(true);
                    setMessage("Datos fiscales guardados.");
                  });
                }}
              >
                <IdentityFields value={issuer} onChange={setIssuer} />
                <button
                  disabled={busy}
                  className="rounded-xl bg-primary px-4 py-2 text-primary-foreground"
                >
                  Guardar datos del negocio
                </button>
              </form>
            ) : (
              <p>
                {saved
                  ? `${issuer.legal_name} · ${issuer.rfc}`
                  : "El administrador debe guardar los datos fiscales del negocio."}
              </p>
            )}
          </section>
          {canManage && (
            <section className="rounded-2xl border border-border p-5">
              <h2 className="mb-3 font-semibold">
                Registrar solicitud de factura
              </h2>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const created = await createInvoiceRequest(
                      orderId.trim(),
                      recipient,
                      requestKey,
                    );
                    setRequests((existing) => [
                      created,
                      ...existing.filter((item) => item.id !== created.id),
                    ]);
                    setOrderId("");
                    setRequestKey(crypto.randomUUID());
                    setMessage(
                      "Solicitud guardada, pendiente de proveedor. La factura no se ha emitido.",
                    );
                  });
                }}
              >
                <label className="block text-sm">
                  Venta completada
                  <select
                    required
                    className={inputClass}
                    value={orderId}
                    onChange={(e) => {
                      setOrderId(e.target.value);
                      setRequestKey(crypto.randomUUID());
                    }}
                  >
                    <option value="">Selecciona una venta reciente</option>
                    {sales
                      .filter(
                        (sale) =>
                          !requests.some(
                            (request) => request.order_id === sale.id,
                          ),
                      )
                      .map((sale) => (
                        <option key={sale.id} value={sale.id}>
                          {formatDateTime(sale.created_at)} ·{" "}
                          {formatMoney(sale.total_amount)} · Folio{" "}
                          {sale.id.slice(0, 8)}
                        </option>
                      ))}
                  </select>
                </label>
                <IdentityFields
                  value={recipient}
                  onChange={(value) => {
                    setRecipient({ ...recipient, ...value });
                    setRequestKey(crypto.randomUUID());
                  }}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    Clave de uso CFDI
                    <input
                      required
                      className={inputClass}
                      value={recipient.cfdi_use}
                      onChange={(e) => {
                        setRecipient({
                          ...recipient,
                          cfdi_use: e.target.value,
                        });
                        setRequestKey(crypto.randomUUID());
                      }}
                    />
                  </label>
                  <label className="text-sm">
                    Correo del cliente
                    <input
                      required
                      type="email"
                      className={inputClass}
                      value={recipient.email}
                      onChange={(e) => {
                        setRecipient({ ...recipient, email: e.target.value });
                        setRequestKey(crypto.randomUUID());
                      }}
                    />
                  </label>
                </div>
                <button
                  disabled={busy || !saved}
                  className="rounded-xl bg-primary px-4 py-2 text-primary-foreground"
                >
                  Guardar solicitud pendiente
                </button>
              </form>
            </section>
          )}
          {canManage && (
            <section className="rounded-2xl border border-border p-5">
              <h2 className="mb-3 font-semibold">Solicitudes recientes</h2>
              {requests.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay solicitudes.
                </p>
              ) : (
                <ul className="space-y-3">
                  {requests.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-border p-3"
                    >
                      <p className="font-medium">
                        {item.recipient_snapshot.legal_name}
                      </p>
                      <p className="text-sm">
                        Folio {item.order_id.slice(0, 8)} ·{" "}
                        {formatMoney(item.total_amount)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Pendiente de proveedor · Sin emitir
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </ViewLayout>
  );
}

export function IntegrationsPage() {
  const { state } = useAuthContext();
  const user = state.status === "authenticated" ? state.user : null;
  if (user?.role !== "owner" && user?.role !== "manager")
    return (
      <ViewLayout>
        <ViewHeader title="Facturación e integraciones" />
        <p>No tienes permiso para consultar esta sección.</p>
      </ViewLayout>
    );
  return <IntegrationContents canManage={user?.role === "owner"} />;
}

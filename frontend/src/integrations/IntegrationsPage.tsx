import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuthContext } from "@/auth/AuthContext";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getOrder, listOrders } from "@/orders/api";
import { formatDateTime, formatMoney } from "@/orders/format";
import type { Order, OrderListItem } from "@/orders/types";
import {
  createInvoiceRequest,
  getReadiness,
  listInvoiceRequests,
  saveIssuer,
  type FiscalIdentity,
  type InvoiceRecipient,
  type InvoiceRequest,
} from "./api";

import { CfdiPanel } from "./CfdiPanel";

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
  initialOrderId = "",
}: {
  canManage?: boolean;
  initialOrderId?: string;
}) {
  const [connectionLabel, setConnectionLabel] = useState("Sin conectar");
  const updateConnectionLabel = useCallback(
    (label: string) => setConnectionLabel(label),
    [],
  );
  const [issuer, setIssuer] = useState<FiscalIdentity>(emptyIdentity);
  const [saved, setSaved] = useState(false);
  const [recipient, setRecipient] = useState<InvoiceRecipient>({
    ...emptyIdentity,
    cfdi_use: "",
    email: "",
  });
  const [orderId, setOrderId] = useState("");
  const [linkedSale, setLinkedSale] = useState<Order | null>(null);
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
    setLoading(true);
    if (canManage && initialOrderId) {
      setOrderId("");
      setLinkedSale(null);
      setMessage("");
    }
    Promise.all([
      getReadiness(),
      canManage ? listInvoiceRequests() : Promise.resolve([]),
      canManage
        ? listOrders({ status: "completed", limit: 100 })
        : Promise.resolve({ items: [] }),
    ])
      .then(async ([state, items, orders]) => {
        if (active) {
          const readinessLabels = {
            not_connected: "Sin conectar",
            test_connected: "Conectada en pruebas",
            live_not_ready: "Live requiere revisión",
            live_ready: "Conectada en Live",
          };
          setConnectionLabel(
            readinessLabels[state.cfdi_status] ?? "Sin conectar",
          );
          setIssuer(state.issuer ?? emptyIdentity);
          setSaved(!!state.issuer);
          setRequests(items);
          setSales(orders.items);
          setLinkedSale(null);
          if (canManage && initialOrderId) {
            setRequestKey(crypto.randomUUID());
            if (items.some((request) => request.order_id === initialOrderId)) {
              setOrderId("");
              setMessage(
                "Esta venta ya tiene una solicitud registrada. Revisa su documento antes de preparar otra emisión.",
              );
            } else {
              const recent = orders.items.find(
                (sale) => sale.id === initialOrderId,
              );
              const linked = recent ?? (await getOrder(initialOrderId));
              if (!active) return;
              if (
                linked.id !== initialOrderId ||
                linked.status !== "completed"
              ) {
                setOrderId("");
                setMessage(
                  "Esta venta no está completada y no puede prepararse para facturación.",
                );
              } else {
                if (!recent) setLinkedSale(linked as Order);
                setOrderId(linked.id);
                setMessage(
                  "Venta del ticket seleccionada. Revisa los datos del receptor y guarda la solicitud para continuar.",
                );
              }
            }
          }
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
  }, [canManage, initialOrderId]);
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
          <h2 className="font-semibold">
            Facturación CFDI · {connectionLabel}
          </h2>
          <p className="mt-2 text-sm">
            Activa la facturación desde Kova con los datos fiscales y el
            certificado de sello digital de tu negocio. Kova administra la
            conexión con el proveedor que certifica tus facturas.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            No generan un CFDI ni un folio fiscal por sí solas. La emisión
            requiere revisar los conceptos y confirmar el envío al proveedor.
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
                <IdentityFields
                  value={issuer}
                  onChange={(value) => {
                    setIssuer(value);
                    setSaved(false);
                  }}
                />
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
            <CfdiPanel
              requests={requests}
              issuerRfc={saved ? issuer.rfc : undefined}
              issuer={saved ? issuer : undefined}
              onConnectionLabel={updateConnectionLabel}
            />
          )}
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
                    {linkedSale &&
                      !requests.some(
                        (request) => request.order_id === linkedSale.id,
                      ) && (
                        <option value={linkedSale.id}>
                          Venta del ticket ·{" "}
                          {formatMoney(linkedSale.total_amount)} · Folio{" "}
                          {linkedSale.id.slice(0, 8)}
                        </option>
                      )}
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
                        Solicitud registrada · Consulta el estado del documento
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
  useDocumentTitle("Facturación e integraciones");
  const [searchParams] = useSearchParams();
  const linkedOrder = searchParams.get("order_id") ?? "";
  const initialOrderId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      linkedOrder,
    )
      ? linkedOrder
      : "";
  const { state } = useAuthContext();
  const user = state.status === "authenticated" ? state.user : null;
  if (user?.role !== "owner" && user?.role !== "manager")
    return (
      <ViewLayout>
        <ViewHeader title="Facturación e integraciones" />
        <p>No tienes permiso para consultar esta sección.</p>
      </ViewLayout>
    );
  return (
    <IntegrationContents
      canManage={user?.role === "owner"}
      initialOrderId={user?.role === "owner" ? initialOrderId : ""}
    />
  );
}

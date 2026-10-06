import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/orders/format";
import type { InvoiceRequest } from "./api";
import { liveCfdiReady } from "./cfdiReadiness";
import { CfdiConnectionPanel } from "./CfdiConnectionPanel";
import { CfdiDocumentsPanel } from "./CfdiDocumentsPanel";
import { CfdiPreparationPanel } from "./CfdiPreparationPanel";
import {
  getCfdiStatus,
  listCfdiDocuments,
  type CfdiDocument,
  type CfdiEnvironment,
  type CfdiStatus,
} from "./cfdiApi";

export function CfdiPanel({
  requests,
  issuerRfc,
  onConnectionLabel,
}: {
  requests: InvoiceRequest[];
  issuerRfc?: string;
  onConnectionLabel: (label: string) => void;
}) {
  const [status, setStatus] = useState<CfdiStatus | null>(null);
  const [environment, setEnvironment] = useState<CfdiEnvironment>("test");
  const [documents, setDocuments] = useState<CfdiDocument[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    Promise.all([getCfdiStatus(), listCfdiDocuments()])
      .then(([publicStatus, items]) => {
        if (active) {
          setStatus(publicStatus);
          setDocuments(items);
        }
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "La conexión CFDI no está disponible. Las solicitudes siguen guardadas.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const connection = status?.connections.find(
    (item) => item.environment === environment,
  );
  const liveReady = liveCfdiReady(
    connection,
    Boolean(status?.storage_available),
    issuerRfc,
  );
  const ready =
    environment === "test"
      ? Boolean(status?.storage_available && connection?.connected && issuerRfc)
      : liveReady;
  useEffect(() => {
    onConnectionLabel(
      connection?.connected
        ? environment === "test"
          ? "Conectada en pruebas"
          : liveReady
            ? "Conectada en Live"
            : "Live requiere revisión"
        : "Sin conectar",
    );
  }, [
    connection?.connected,
    connection?.production_ready,
    environment,
    liveReady,
    onConnectionLabel,
  ]);
  const refresh = useCallback(async () => {
    const [next, items] = await Promise.all([
      getCfdiStatus(),
      listCfdiDocuments(),
    ]);
    setStatus(next);
    setDocuments(items);
    setError("");
  }, []);
  const updateDocument = (document: CfdiDocument) => {
    setDocuments((items) => [
      document,
      ...items.filter((item) => item.id !== document.id),
    ]);
  };
  const selectedBlocked = documents.some(
    (document) =>
      document.request_id === selected &&
      document.environment === environment &&
      !["rejected", "canceled"].includes(document.state),
  );
  return (
    <div className="space-y-4">
      {loading && (
        <p role="status">Consultando conexión y documentos fiscales…</p>
      )}
      {error && (
        <div className="rounded-xl border p-4 space-y-3">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void refresh()
                .catch((e: unknown) =>
                  setError(
                    e instanceof Error
                      ? e.message
                      : "No pudimos consultar el proveedor.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Consultar conexión CFDI
          </Button>
        </div>
      )}
      {status && (
        <>
          <CfdiConnectionPanel
            status={status}
            environment={environment}
            onEnvironment={(value) => {
              if (!busy) {
                setEnvironment(value);
                setSelected(null);
              }
            }}
            onStatus={setStatus}
            issuerRfc={issuerRfc}
            locked={busy}
          />
          <section className="rounded-2xl border border-border p-5 space-y-3">
            <h2 className="font-semibold">
              Preparar solicitudes para{" "}
              {environment === "test"
                ? "Test · Sin validez fiscal"
                : "Live · Emisión fiscal real"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Selecciona una solicitud guardada. La emisión requiere
              clasificación SAT y revisión de la vista previa. IEPS,
              retenciones, PPD y facturas globales no se emiten desde este
              flujo.
            </p>
            {requests.length === 0 ? (
              <p className="text-sm">
                Guarda una solicitud con los datos del receptor para preparar la
                factura.
              </p>
            ) : (
              <ul className="space-y-3">
                {requests.map((request) => {
                  const activeDocument = documents.find(
                    (document) =>
                      document.request_id === request.id &&
                      document.environment === environment &&
                      !["rejected", "canceled"].includes(document.state),
                  );
                  return (
                    <li
                      key={request.id}
                      className="rounded-xl border p-3 flex flex-wrap gap-3 items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="font-medium break-words">
                          {request.recipient_snapshot.legal_name}
                        </p>
                        <p className="text-sm">
                          Venta {request.order_id.slice(0, 8)} ·{" "}
                          {formatMoney(request.total_amount)}
                        </p>
                        {activeDocument && (
                          <p className="text-xs text-muted-foreground">
                            Ya existe un documento o intento activo en este
                            ambiente. Consulta su estado.
                          </p>
                        )}
                      </div>
                      <Button
                        disabled={busy || Boolean(activeDocument)}
                        onClick={() => setSelected(request.id)}
                      >
                        Preparar emisión
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {selected && !selectedBlocked && (
            <CfdiPreparationPanel
              key={`${selected}:${environment}`}
              requestId={selected}
              environment={environment}
              ready={ready}
              organizationRfc={
                environment === "live"
                  ? (connection?.issuer_rfc ?? undefined)
                  : undefined
              }
              onDocument={(document) => {
                updateDocument(document);
                setSelected(null);
              }}
              onBusy={setBusy}
            />
          )}
          <CfdiDocumentsPanel
            documents={documents}
            onDocument={updateDocument}
            onRefresh={refresh}
          />
        </>
      )}
    </div>
  );
}

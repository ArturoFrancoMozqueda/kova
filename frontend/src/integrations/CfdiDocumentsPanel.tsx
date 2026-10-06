import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime, formatMoney } from "@/orders/format";
import {
  cancelCfdi,
  downloadCfdi,
  reconcileCfdi,
  type CfdiDocument,
} from "./cfdiApi";

export const documentLabels: Record<CfdiDocument["state"], string> = {
  prepared: "Preparado · Sin emitir",
  submitting: "Enviado · Confirmación pendiente",
  unknown: "Resultado desconocido · Consultar proveedor",
  pending: "Pendiente en el proveedor",
  issued: "Emitido · UUID confirmado",
  cancel_pending: "Cancelación pendiente de confirmación",
  canceled: "Cancelación confirmada",
  rejected: "Rechazado · Sin emitir",
  integrity_error: "Documento por verificar · No confirmado",
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function CfdiDocumentsPanel({
  documents,
  onDocument,
  onRefresh,
}: {
  documents: CfdiDocument[];
  onDocument: (document: CfdiDocument) => void;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [canceling, setCanceling] = useState<CfdiDocument | null>(null);
  const [motive, setMotive] = useState<"01" | "02" | "03" | "">("");
  const [substitution, setSubstitution] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const keys = useRef(new Map<string, string>());
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos completar la operación. Consulta el estado antes de repetirla.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (
      !canceling ||
      !motive ||
      !confirmed ||
      (motive === "01" && !uuidPattern.test(substitution.trim()))
    )
      return;
    const body = {
      motive,
      ...(motive === "01" ? { substitution_uuid: substitution.trim() } : {}),
    };
    const fingerprint = JSON.stringify({ id: canceling.id, body });
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    const result = await cancelCfdi(canceling.id, body, key);
    onDocument(result);
    setCanceling(null);
  }
  const validCancellation = Boolean(
    motive &&
      confirmed &&
      (motive !== "01" || uuidPattern.test(substitution.trim())),
  );
  return (
    <section
      className="rounded-2xl border border-border p-5 space-y-4"
      aria-label="Documentos CFDI"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="font-semibold">Documentos y estado del proveedor</h2>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(onRefresh)}
        >
          Actualizar documentos
        </Button>
      </div>
      {error && !canceling && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay intentos de emisión en esta sucursal.
        </p>
      ) : (
        <ul className="space-y-3">
          {documents.map((document) => {
            const reconcile = [
              "prepared",
              "submitting",
              "unknown",
              "pending",
              "cancel_pending",
              "integrity_error",
            ].includes(document.state);
            return (
              <li
                key={document.id}
                className="rounded-xl border p-3 space-y-2 min-w-0"
              >
                <p className="font-medium">
                  {document.environment === "test"
                    ? "Test · Sin validez fiscal"
                    : "Live · Producción fiscal"}{" "}
                  · {formatMoney(document.total_amount)}
                </p>
                <p className="text-sm" role="status">
                  {documentLabels[document.state]}
                </p>
                <p className="text-xs text-muted-foreground">
                  Venta {document.order_id.slice(0, 8)} ·{" "}
                  {formatDateTime(document.updated_at)}
                </p>
                {document.recipient_snapshot && (
                  <p className="text-sm break-words">
                    Receptor del documento:{" "}
                    {document.recipient_snapshot.legal_name} ·{" "}
                    {document.recipient_snapshot.rfc}
                  </p>
                )}
                {document.uuid && (
                  <p className="text-sm break-all">UUID: {document.uuid}</p>
                )}
                {document.last_error_code && (
                  <p className="text-sm text-destructive">
                    Referencia del error: {document.last_error_code}. Consulta
                    el estado antes de intentar otra emisión.
                  </p>
                )}
                {document.cancellation_status && (
                  <p className="text-sm">
                    Respuesta de cancelación: {document.cancellation_status}
                  </p>
                )}
                {(document.state === "unknown" ||
                  document.state === "submitting" ||
                  document.state === "pending") && (
                  <p className="text-sm text-muted-foreground">
                    El resultado aún no está confirmado. Consultar al proveedor
                    no crea otra factura.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {reconcile && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          onDocument(await reconcileCfdi(document.id)),
                        )
                      }
                    >
                      Consultar estado con proveedor
                    </Button>
                  )}
                  {document.xml_available && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          downloadCfdi(
                            document.id,
                            "xml",
                            document.environment,
                          ),
                        )
                      }
                    >
                      Descargar XML
                    </Button>
                  )}
                  {document.provider_id &&
                    ["issued", "cancel_pending", "canceled"].includes(
                      document.state,
                    ) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            downloadCfdi(
                              document.id,
                              "pdf",
                              document.environment,
                            ),
                          )
                        }
                      >
                        Descargar PDF
                      </Button>
                    )}
                  {document.state === "issued" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setCanceling(document);
                        setMotive("");
                        setSubstitution("");
                        setConfirmed(false);
                        setError("");
                      }}
                    >
                      Solicitar cancelación
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={Boolean(canceling)}
        onClose={() => {
          if (!busy) setCanceling(null);
        }}
      >
        <DialogTitle>Confirmar solicitud de cancelación</DialogTitle>
        <p className="text-sm mt-4">
          {canceling?.environment === "live"
            ? "Esta acción solicita al proveedor la cancelación de un CFDI real. La factura sólo se considera cancelada cuando el SAT lo confirme."
            : "Cancelarás un documento del ambiente Test, sin validez fiscal."}
        </p>
        <p className="text-sm my-3 break-all">UUID: {canceling?.uuid}</p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (validCancellation) void run(cancel);
          }}
        >
          <fieldset disabled={busy} className="space-y-3 min-w-0">
            <div>
              <Label htmlFor="cfdi-cancel-motive">
                Motivo SAT de cancelación
              </Label>
              <Select
                id="cfdi-cancel-motive"
                required
                value={motive}
                onChange={(e) => {
                  setMotive(e.target.value as typeof motive);
                  setSubstitution("");
                  setConfirmed(false);
                }}
              >
                <option value="">Selecciona el motivo</option>
                <option value="01">
                  01 · Errores con relación a otra factura
                </option>
                <option value="02">
                  02 · Errores sin relación a otra factura
                </option>
                <option value="03">03 · No se llevó a cabo la operación</option>
              </Select>
            </div>
            {motive === "01" && (
              <div>
                <Label htmlFor="cfdi-substitution">
                  UUID de la factura sustituta
                </Label>
                <Input
                  id="cfdi-substitution"
                  required
                  value={substitution}
                  pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                  maxLength={36}
                  onChange={(e) => {
                    setSubstitution(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </div>
            )}
            <label className="flex gap-3 items-start text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                Confirmo el motivo y entiendo que se enviará una solicitud de
                cancelación al proveedor.
              </span>
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !validCancellation}>
              {busy ? "Solicitando…" : "Enviar solicitud de cancelación"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setCanceling(null)}
            >
              Volver
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </form>
      </Dialog>
    </section>
  );
}

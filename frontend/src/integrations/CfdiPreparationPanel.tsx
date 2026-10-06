import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { moneyToCents } from "@/lib/money";
import { formatMoney } from "@/orders/format";
import {
  getInvoiceContext,
  issueCfdi,
  previewCfdi,
  type CfdiDocument,
  type CfdiEnvironment,
  type InvoiceContext,
  type InvoicePreparation,
  type InvoicePreview,
  type PaymentForm,
  type TaxKind,
} from "./cfdiApi";

import type { InvoiceRecipient } from "./api";

const recipientLabels: Record<keyof InvoiceRecipient, string> = {
  rfc: "RFC del receptor",
  legal_name: "Razón social del receptor",
  postal_code: "Código postal fiscal del receptor",
  tax_regime: "Régimen fiscal del receptor",
  cfdi_use: "Uso CFDI del receptor",
  email: "Correo del receptor",
};
const taxes: { value: TaxKind; label: string }[] = [
  { value: "iva16", label: "IVA 16%" },
  { value: "iva8", label: "IVA 8%" },
  { value: "iva0", label: "IVA 0%" },
  { value: "exempt", label: "Exento de IVA" },
  { value: "not_subject", label: "No objeto de impuesto" },
];
const paymentLabels: Record<PaymentForm, string> = {
  "01": "01 · Efectivo",
  "03": "03 · Transferencia electrónica",
  "04": "04 · Tarjeta de crédito",
  "28": "28 · Tarjeta de débito",
};
type DraftLine = {
  order_item_id: string;
  product_key: string;
  unit_key: string;
  tax_kind: TaxKind | "";
  inclusion: "included" | "additional" | "";
};

export function CfdiPreparationPanel({
  requestId,
  environment,
  ready,
  organizationRfc,
  onDocument,
  onBusy,
}: {
  requestId: string;
  environment: CfdiEnvironment;
  ready: boolean;
  organizationRfc?: string;
  onDocument: (value: CfdiDocument) => void;
  onBusy: (value: boolean) => void;
}) {
  const [context, setContext] = useState<InvoiceContext | null>(null);
  const [recipient, setRecipient] = useState<InvoiceRecipient | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [payment, setPayment] = useState<PaymentForm | "">("");
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const keys = useRef(new Map<string, string>());
  const reviewBody = useRef<InvoicePreparation | null>(null);
  useEffect(() => {
    let active = true;
    getInvoiceContext(requestId)
      .then((data) => {
        if (active) {
          setContext(data);
          setRecipient({ ...data.recipient });
          setLines(
            data.lines.map((line) => ({
              order_item_id: line.order_item_id,
              product_key: "",
              unit_key: "",
              tax_kind: "",
              inclusion: "",
            })),
          );
        }
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "No pudimos cargar los conceptos de la venta.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requestId]);
  const issuerMatches =
    !organizationRfc ||
    context?.issuer.rfc.toUpperCase() === organizationRfc.toUpperCase();
  const canEmit = ready && issuerMatches;
  const complete = Boolean(
    recipient &&
      Object.values(recipient).every((value) => value.trim()) &&
      payment &&
      lines.length &&
      lines.every(
        (line) =>
          line.product_key.length === 8 &&
          /^[0-9]{8}$/.test(line.product_key) &&
          /^[A-Z0-9]{2,3}$/.test(line.unit_key) &&
          line.tax_kind &&
          line.inclusion,
      ),
  );
  function invalidate() {
    setPreview(null);
    setReviewed(false);
    reviewBody.current = null;
    setError("");
  }
  function updateLine(index: number, patch: Partial<DraftLine>) {
    invalidate();
    setLines((previous) =>
      previous.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }
  function body(): InvoicePreparation {
    return {
      request_id: requestId,
      recipient: recipient ? { ...recipient } : undefined,
      environment,
      payment_form: payment as PaymentForm,
      lines: lines.map((line) => ({
        order_item_id: line.order_item_id,
        product_key: line.product_key,
        unit_key: line.unit_key,
        tax_kind: line.tax_kind as TaxKind,
        tax_included: line.inclusion === "included",
      })),
    };
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "No pudimos completar la operación. Consulta el estado antes de reintentar.",
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function prepare() {
    setPreview(null);
    setReviewed(false);
    reviewBody.current = null;
    const payload = body();
    const result = await previewCfdi(payload);
    if (
      !context ||
      moneyToCents(result.total_amount) !== moneyToCents(context.total_amount)
    ) {
      throw new Error(
        "La vista previa no coincide con el total cobrado. Revisa los impuestos con tu contador antes de emitir.",
      );
    }
    reviewBody.current = payload;
    setPreview(result);
    setReviewed(false);
  }
  async function emit() {
    const payload = reviewBody.current;
    if (!payload || !reviewed || !canEmit) return;
    const fingerprint = JSON.stringify(payload);
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    const document = await issueCfdi(payload, key);
    onDocument(document);
    setConfirm(false);
  }
  return (
    <section
      className="rounded-2xl border border-border p-5 space-y-4"
      aria-label="Preparar CFDI"
    >
      <h2 className="font-semibold">Preparar factura de la venta</h2>
      <p className="text-sm">
        {environment === "test"
          ? "Ambiente Test · Sin validez fiscal"
          : "Ambiente Live · Emisión fiscal real"}
        . Los importes provienen de la venta original. Consulta con tu contador
        las claves SAT y el tratamiento de cada concepto.
      </p>
      {loading && <p role="status">Cargando conceptos históricos…</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {context && (
        <>
          <p className="text-sm">
            Emisor de la solicitud: {context.issuer.legal_name} ·{" "}
            {context.issuer.rfc}
          </p>
          <p className="font-medium">
            Total cobrado: {formatMoney(context.total_amount)} · Descuento:{" "}
            {formatMoney(context.discount_amount)}
          </p>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (complete) void run(prepare);
            }}
          >
            <fieldset disabled={busy} className="space-y-4 min-w-0">
              {recipient && (
                <fieldset className="rounded-xl border p-3 space-y-3 min-w-0">
                  <legend className="px-1 font-medium">
                    Datos del receptor para esta emisión
                  </legend>
                  <p className="text-sm text-muted-foreground">
                    Puedes corregir los datos antes de emitir. La solicitud
                    original y los documentos anteriores conservan sus datos
                    registrados.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      Object.keys(recipientLabels) as (keyof InvoiceRecipient)[]
                    ).map((field) => (
                      <div key={field}>
                        <Label htmlFor={`cfdi-recipient-${field}`}>
                          {recipientLabels[field]}
                        </Label>
                        <Input
                          id={`cfdi-recipient-${field}`}
                          type={field === "email" ? "email" : "text"}
                          required
                          value={recipient[field]}
                          maxLength={
                            field === "rfc"
                              ? 13
                              : field === "postal_code"
                                ? 5
                                : field === "tax_regime" || field === "cfdi_use"
                                  ? 3
                                  : field === "email"
                                    ? 254
                                    : 300
                          }
                          pattern={
                            field === "postal_code"
                              ? "[0-9]{5}"
                              : field === "tax_regime"
                                ? "[0-9]{3}"
                                : field === "rfc"
                                  ? "[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}"
                                  : field === "cfdi_use"
                                    ? "[A-Z][0-9]{2}"
                                    : undefined
                          }
                          onChange={(e) => {
                            invalidate();
                            setRecipient((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    [field]: ["rfc", "cfdi_use"].includes(field)
                                      ? e.target.value.toUpperCase()
                                      : e.target.value,
                                  }
                                : previous,
                            );
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
              )}

              <div>
                <Label htmlFor="cfdi-payment">Forma de pago SAT</Label>
                <Select
                  id="cfdi-payment"
                  required
                  value={payment}
                  onChange={(e) => {
                    invalidate();
                    setPayment(e.target.value as PaymentForm);
                  }}
                >
                  <option value="">Elige la forma del pago recibido</option>
                  {context.suggested_payment_forms.map((value) => (
                    <option key={value} value={value}>
                      {paymentLabels[value]}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Debe corresponder al pago registrado. Para tarjeta, elige
                  crédito o débito según el cobro real.
                </p>
              </div>
              {lines.map((line, index) => {
                const original = context.lines[index];
                const chargedTax = Number(original.tax_amount) > 0;
                return (
                  <fieldset
                    key={line.order_item_id}
                    className="rounded-xl border p-3 space-y-3 min-w-0"
                  >
                    <legend className="px-1 font-medium break-words">
                      {original.product_name} · {original.quantity} unidades
                    </legend>
                    <p className="text-sm">
                      Importe histórico:{" "}
                      {formatMoney(original.line_total_amount)} · Impuesto
                      adicional cobrado: {formatMoney(original.tax_amount)}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`cfdi-product-${index}`}>
                          Clave SAT del producto {index + 1}
                        </Label>
                        <Input
                          id={`cfdi-product-${index}`}
                          inputMode="numeric"
                          required
                          pattern="[0-9]{8}"
                          maxLength={8}
                          value={line.product_key}
                          onChange={(e) =>
                            updateLine(index, {
                              product_key: e.target.value.trim(),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor={`cfdi-unit-${index}`}>
                          Clave SAT de unidad {index + 1}
                        </Label>
                        <Input
                          id={`cfdi-unit-${index}`}
                          required
                          pattern="[A-Z0-9]{2,3}"
                          maxLength={3}
                          value={line.unit_key}
                          onChange={(e) =>
                            updateLine(index, {
                              unit_key: e.target.value.toUpperCase().trim(),
                            })
                          }
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor={`cfdi-tax-${index}`}>
                        Tratamiento fiscal {index + 1}
                      </Label>
                      <Select
                        id={`cfdi-tax-${index}`}
                        required
                        value={line.tax_kind}
                        onChange={(e) =>
                          updateLine(index, {
                            tax_kind: e.target.value as TaxKind,
                          })
                        }
                      >
                        <option value="">Elige según el concepto</option>
                        {taxes.map((tax) => (
                          <option key={tax.value} value={tax.value}>
                            {tax.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`cfdi-included-${index}`}>
                        Impuesto en el precio {index + 1}
                      </Label>
                      <Select
                        id={`cfdi-included-${index}`}
                        required
                        value={line.inclusion}
                        onChange={(e) =>
                          updateLine(index, {
                            inclusion: e.target.value as DraftLine["inclusion"],
                          })
                        }
                      >
                        <option value="">Declara cómo se cobró</option>
                        {!chargedTax && (
                          <option value="included">
                            Incluido en el importe cobrado
                          </option>
                        )}
                        <option value="additional">
                          {chargedTax
                            ? "Adicional: ya cobrado en la venta"
                            : "Sin impuesto adicional cobrado"}
                        </option>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        La vista previa debe conciliar con lo cobrado. No añade
                        impuestos ni modifica la venta.
                      </p>
                    </div>
                  </fieldset>
                );
              })}
            </fieldset>
            {!canEmit && (
              <p role="status">
                Verifica la conexión, el emisor registrado en la solicitud y los
                certificados del ambiente elegido antes de preparar la emisión.
              </p>
            )}
            <Button type="submit" disabled={busy || !complete}>
              {busy ? "Procesando…" : "Calcular vista previa fiscal"}
            </Button>
          </form>
          {preview && (
            <div
              className="rounded-xl border p-4 space-y-3"
              aria-label="Vista previa fiscal"
            >
              <h3 className="font-semibold">
                Revisa antes de emitir ·{" "}
                {preview.environment === "test"
                  ? "Test, sin validez fiscal"
                  : "Live, emisión real"}
              </h3>
              {preview.recipient_snapshot && (
                <p className="text-sm break-words">
                  Receptor de esta emisión:{" "}
                  {preview.recipient_snapshot.legal_name} ·{" "}
                  {preview.recipient_snapshot.rfc} · CP{" "}
                  {preview.recipient_snapshot.postal_code} · Régimen{" "}
                  {preview.recipient_snapshot.tax_regime} · Uso{" "}
                  {preview.recipient_snapshot.cfdi_use}
                </p>
              )}
              <ul className="space-y-2 text-sm">
                {preview.lines.map((line) => (
                  <li key={line.order_item_id} className="break-words">
                    {line.product_name} · SAT {line.product_key} /{" "}
                    {line.unit_key} ·{" "}
                    {taxes.find((tax) => tax.value === line.tax_kind)?.label} ·{" "}
                    {formatMoney(line.total_amount)}
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>Subtotal</dt>
                <dd>{formatMoney(preview.subtotal_amount)}</dd>
                <dt>Descuento</dt>
                <dd>{formatMoney(preview.discount_amount)}</dd>
                <dt>Impuestos</dt>
                <dd>{formatMoney(preview.tax_amount)}</dd>
                <dt className="font-semibold">Total</dt>
                <dd className="font-semibold">
                  {formatMoney(preview.total_amount)}
                </dd>
              </dl>
              <label className="flex gap-3 items-start text-sm">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                <span>
                  Revisé el receptor, las claves SAT, los impuestos y el total
                  de esta vista previa.
                </span>
              </label>
              <Button
                disabled={busy || !reviewed || !canEmit}
                onClick={() => setConfirm(true)}
              >
                {environment === "test"
                  ? "Emitir documento de prueba"
                  : "Emitir CFDI Live"}
              </Button>
            </div>
          )}
        </>
      )}
      <Dialog
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
      >
        <DialogTitle>
          {environment === "test"
            ? "Confirmar documento de prueba"
            : "Confirmar emisión fiscal Live"}
        </DialogTitle>
        <p className="text-sm my-4">
          {environment === "test"
            ? "Se enviará al proveedor en Test. Este documento no tendrá validez fiscal."
            : "Se enviará una factura al proveedor para timbrado fiscal. Revisa los datos: una factura emitida requiere una cancelación fiscal para corregirse."}
        </p>
        <p className="font-semibold mb-4">
          Total: {preview ? formatMoney(preview.total_amount) : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run(emit)}>
            {busy ? "Enviando…" : "Confirmar envío al proveedor"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Volver a revisar
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-destructive mt-3">
            {error}
          </p>
        )}
      </Dialog>
    </section>
  );
}

import { useId, useMemo, useState } from "react";
import { copy } from "../i18n/messages";
import type { OrderItem, RefundPaymentAllocation, RefundPayload } from "./types";
import { centsToMoney, moneyToCents } from "@/lib/money";
import { formatMoney } from "./format";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";

type RefundModalProps = {
  items: OrderItem[];
  disabled: boolean;
  fieldsLocked?: boolean;
  initialPayload?: RefundPayload;
  availablePayments?: RefundPaymentAllocation[];
  refundedQuantities?: Record<string, number>;
  onCancel: () => void;
  onSubmit: (payload: RefundPayload) => Promise<void>;
  onResolve?: () => Promise<void>;
};

const refundReasons = ["customer_return", "defective", "wrong_item", "other"];
const refundPaymentMethods = ["cash", "bank_transfer", "manual_card"] as const;

export function RefundModal({ items, disabled, fieldsLocked = false, initialPayload, availablePayments, refundedQuantities = {}, onCancel, onSubmit, onResolve }: RefundModalProps) {
  const [reason, setReason] = useState(initialPayload?.reason ?? refundReasons[0]);
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<(typeof refundPaymentMethods)[number] | "original">(
    initialPayload?.refund_payments ? "original" : initialPayload?.refund_payment_method ?? ((availablePayments?.length ?? 0) > 1 ? "original" : availablePayments?.[0]?.method ?? "cash"),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(initialPayload?.items.map(item => [item.order_item_id, item.quantity]) ?? []));
  const reasonId = useId();
  const paymentMethodId = useId();

  const selectedItems = useMemo(
    () =>
      items
        .map((item) => ({
          order_item_id: item.id,
          quantity: quantities[item.id] ?? 0,
        }))
        .filter((item) => item.quantity > 0),
    [items, quantities],
  );

  const refundCents = selectedItems.reduce((sum, selected) => {
    const item = items.find(line => line.id === selected.order_item_id)!;
    const refunded = refundedQuantities[item.id] ?? 0;
    const originalQuantity = item.quantity + refunded;
    const total = BigInt(moneyToCents(item.line_total_amount));
    const rounded = (quantity: number) => Number((2n * total * BigInt(quantity) + BigInt(originalQuantity)) / (2n * BigInt(originalQuantity)));
    return sum + rounded(refunded + selected.quantity) - rounded(refunded);
  }, 0);
  let remaining = refundCents;
  const distribution = fieldsLocked && initialPayload?.refund_payments ? initialPayload.refund_payments : (availablePayments ?? []).flatMap(payment => {
    const cents = Math.min(remaining, moneyToCents(payment.amount));
    remaining -= cents;
    return cents > 0 ? [{ method: payment.method, amount: centsToMoney(cents) }] : [];
  });
  const distributionValid = fieldsLocked || refundPaymentMethod !== "original" || (refundCents > 0 && distribution.reduce((sum, payment) => sum + moneyToCents(payment.amount), 0) === refundCents);
  const canSubmit = selectedItems.length > 0 && !disabled && distributionValid;

  return (
    <Dialog open onClose={onCancel}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4" />
          {copy.refundModal.title}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={reasonId}>{copy.refundModal.reason}</Label>
          <Select
            id={reasonId}
            value={reason}
            disabled={disabled || fieldsLocked}
            onChange={(event) => setReason(event.target.value)}
          >
            {refundReasons.map((option) => (
              <option key={option} value={option}>
                {copy.refundModal.reasons[option as keyof typeof copy.refundModal.reasons]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={paymentMethodId}>{copy.refundModal.refundPaymentMethod}</Label>
          <Select
            id={paymentMethodId}
            value={refundPaymentMethod}
            disabled={disabled || fieldsLocked}
            onChange={(event) =>
              setRefundPaymentMethod(event.target.value as (typeof refundPaymentMethods)[number] | "original")
            }
          >
            {((availablePayments?.length ?? 0) > 1 || initialPayload?.refund_payments) && <option value="original">Distribuir entre medios originales</option>}
            {refundPaymentMethods.map((option) => (
              <option key={option} value={option}>
                {copy.refundModal.paymentMethods[option]}
              </option>
            ))}
          </Select>
          {refundPaymentMethod === "original" && <div className="space-y-1 rounded-lg border p-3 text-sm" aria-live="polite">
            <p>Se registrará la devolución con esta distribución:</p>
            {distribution.map(payment => <p key={payment.method} className="flex justify-between gap-3"><span>{copy.refundModal.paymentMethods[payment.method]}</span><span>{formatMoney(payment.amount)}</span></p>)}
            {!distributionValid && <p className="text-destructive">Los medios originales no tienen saldo suficiente para esta devolución.</p>}
          </div>}
        </div>

        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{item.product_name}</p>
                <p className="text-xs text-muted-foreground">Máximo: {item.quantity}</p>
              </div>
              <div className="w-20">
                <Input
                  aria-label={`${item.product_name} ${copy.refundModal.quantity}`}
                  min="0"
                  max={item.quantity}
                  type="number"
                  inputMode="numeric"
                  disabled={disabled || fieldsLocked}
                  value={quantities[item.id] ?? 0}
                  onChange={(event) => {
                    const raw = Number(event.target.value);
                    const clamped = Math.max(0, Math.min(item.quantity, Number.isFinite(raw) ? Math.floor(raw) : 0));
                    setQuantities((current) => ({
                      ...current,
                      [item.id]: clamped,
                    }));
                  }}
                  className="text-center"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {fieldsLocked && onResolve && <div className="mt-4 space-y-2">
        <p className="text-sm text-muted-foreground">Puedes confirmar si ya se registró. Si no ocurrió, bloquearemos el intento anterior para que prepares una nueva devolución.</p>
        <Button className="w-full whitespace-normal" variant="outline" disabled={disabled} onClick={() => void onResolve()}>Revisar resultado y desbloquear</Button>
      </div>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{copy.refundModal.cancel}</Button>
        <Button
          disabled={!canSubmit}
          onClick={() => onSubmit(fieldsLocked && initialPayload ? initialPayload : { reason, ...(refundPaymentMethod === "original" ? { refund_payments: distribution } : { refund_payment_method: refundPaymentMethod }), items: selectedItems })}
        >
          {copy.refundModal.submit}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

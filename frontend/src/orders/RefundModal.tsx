import { useMemo, useState } from "react";
import { copy } from "../i18n/messages";
import type { OrderItem, RefundPayload } from "./types";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";

type RefundModalProps = {
  items: OrderItem[];
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (payload: RefundPayload) => Promise<void>;
};

const refundReasons = ["customer_return", "defective", "wrong_item", "other"];

export function RefundModal({ items, disabled, onCancel, onSubmit }: RefundModalProps) {
  const [reason, setReason] = useState(refundReasons[0]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

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

  const canSubmit = selectedItems.length > 0 && !disabled;

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
          <Label>{copy.refundModal.reason}</Label>
          <Select value={reason} onChange={(event) => setReason(event.target.value)}>
            {refundReasons.map((option) => (
              <option key={option} value={option}>
                {copy.refundModal.reasons[option as keyof typeof copy.refundModal.reasons]}
              </option>
            ))}
          </Select>
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
                  value={quantities[item.id] ?? 0}
                  onChange={(event) => {
                    const raw = Number(event.target.value);
                    const clamped = Math.max(0, Math.min(item.quantity, Number.isFinite(raw) ? raw : 0));
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

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{copy.refundModal.cancel}</Button>
        <Button
          disabled={!canSubmit}
          onClick={() => onSubmit({ reason, items: selectedItems })}
        >
          {copy.refundModal.submit}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

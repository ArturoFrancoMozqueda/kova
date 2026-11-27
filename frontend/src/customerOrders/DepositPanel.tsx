import { useId, useState } from "react";
import { HandCoins, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime, formatMoney } from "@/orders/format";
import { getOpenShift } from "@/shifts/api";
import { recordCustomerOrderDeposit, refundCustomerOrderDeposit } from "./api";
import { centsOf, heldByMethod, moneyOf } from "./deposits";
import type { CustomerOrder, DepositMethod } from "./types";

export const depositMethodLabels: Record<DepositMethod, string> = {
  cash: "Efectivo",
  bank_transfer: "Transferencia",
  manual_card: "Tarjeta manual",
};

const entryLabels = { deposit: "Anticipo", refund: "Devolución", retained: "Conservado al cancelar" } as const;

type Props = {
  order: CustomerOrder;
  writable: boolean;
  isManager: boolean;
  busy: boolean;
  /** Runs one change against the order; resolves true when it was saved. */
  onMutate: (mutation: () => Promise<CustomerOrder>) => Promise<boolean>;
};

/** Money received before settling: balance, history and the actions to add or return it. */
export function DepositPanel({ order, writable, isManager, busy, onMutate }: Props) {
  const deposits = order.deposits;
  const [dialog, setDialog] = useState<"receive" | "refund" | null>(null);
  const [method, setMethod] = useState<DepositMethod>("bank_transfer");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [openShift, setOpenShift] = useState<boolean | undefined>(undefined);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const ids = { method: useId(), amount: useId(), note: useId() };
  if (!deposits) return null;

  const balanceCents = centsOf(deposits.balance_amount);
  const dueCents = centsOf(deposits.due_amount);
  const held = heldByMethod(deposits.entries);
  const open = order.payment_status === "unpaid" && !["fulfilled", "cancelled"].includes(order.status);
  const canReceive = writable && open && dueCents > 0;
  const canRefund = writable && isManager && balanceCents > 0 && !["fulfilled", "cancelled"].includes(order.status);
  const minimumCents = centsOf(deposits.minimum_amount);
  const amountCents = centsOf(amount);
  const limitCents = dialog === "refund" ? Math.min(centsOf(held[method] ?? "0"), balanceCents) : dueCents;
  const valid = amountCents > 0 && amountCents <= limitCents && (dialog !== "refund" || note.trim().length > 0)
    && !(dialog === "receive" && method === "cash" && openShift !== true);

  const start = (kind: "receive" | "refund") => {
    setKey(crypto.randomUUID());
    setDialog(kind);
    setNote("");
    if (kind === "receive") {
      setMethod("bank_transfer");
      // Suggest what the business's minimum still asks for, if anything.
      const missing = minimumCents - balanceCents;
      setAmount(missing > 0 ? moneyOf(missing) : "");
      void getOpenShift().then((shift) => setOpenShift(Boolean(shift))).catch(() => setOpenShift(false));
    } else {
      const first = (Object.keys(held) as DepositMethod[])[0] ?? "bank_transfer";
      setMethod(first);
      setAmount(held[first] ?? "");
    }
  };

  const submit = () => {
    if (!valid || !dialog) return;
    const body = { method, amount: moneyOf(amountCents) };
    void onMutate(() => dialog === "receive"
      ? recordCustomerOrderDeposit(order.id, order.version, { ...body, reference: note }, key)
      : refundCustomerOrderDeposit(order.id, order.version, { ...body, reason: note.trim() }, key),
    ).then((saved) => { if (saved) setDialog(null); });
  };

  return (
    <div className="mt-4 space-y-3 border-t pt-4 text-sm">
      {balanceCents > 0 || deposits.entries.length ? (
        <dl className="space-y-1 tabular-nums">
          <div className="flex justify-between"><dt className="text-muted-foreground">Anticipo a favor</dt><dd className="font-medium">{formatMoney(deposits.balance_amount)}</dd></div>
          {!deposits.applied ? <div className="flex justify-between"><dt className="text-muted-foreground">Por cobrar al entregar</dt><dd className="font-semibold">{formatMoney(deposits.due_amount)}</dd></div> : <div className="text-muted-foreground">El anticipo se aplicó a la venta.</div>}
        </dl>
      ) : <p className="text-muted-foreground">Sin anticipo registrado.</p>}
      {order.status === "new" && minimumCents > balanceCents ? (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning-foreground">Este negocio pide un anticipo de {formatMoney(deposits.minimum_amount)} para confirmar el pedido.</p>
      ) : null}
      {deposits.entries.length ? (
        <ul className="space-y-1.5" aria-label="Movimientos del anticipo">
          {deposits.entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap justify-between gap-x-3 text-xs">
              <span>{entryLabels[entry.kind]}{entry.method ? ` · ${depositMethodLabels[entry.method]}` : ""}{entry.reason ? ` · ${entry.reason}` : entry.reference ? ` · ${entry.reference}` : ""}</span>
              <span className="tabular-nums text-muted-foreground">{entry.kind === "deposit" ? "" : "−"}{formatMoney(entry.amount)} · {formatDateTime(entry.created_at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canReceive || canRefund ? (
        <div className="flex flex-wrap gap-2 print:hidden">
          {canReceive ? <Button variant="outline" disabled={busy} onClick={() => start("receive")}><HandCoins className="mr-2 h-4 w-4" /> Registrar anticipo</Button> : null}
          {canRefund ? <Button variant="ghost" disabled={busy} onClick={() => start("refund")}><Undo2 className="mr-2 h-4 w-4" /> Devolver anticipo</Button> : null}
        </div>
      ) : null}

      <Dialog open={dialog !== null && writable} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>{dialog === "refund" ? "Devolver anticipo" : "Registrar anticipo"}</DialogTitle>
          <DialogDescription>{dialog === "refund"
            ? "Devuelve parte o todo el anticipo por el mismo medio con que se recibió. El efectivo sale de la caja del turno."
            : `Falta ${formatMoney(deposits.due_amount)} por cobrar. El anticipo no es venta: la venta se registra al liquidar el pedido.`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor={ids.method}>Medio</Label>
            <Select id={ids.method} value={method} onChange={(event) => { setMethod(event.target.value as DepositMethod); if (dialog === "refund") setAmount(held[event.target.value as DepositMethod] ?? ""); }}>
              {(dialog === "refund" ? (Object.keys(held) as DepositMethod[]) : (["cash", "bank_transfer", "manual_card"] as DepositMethod[])).map((value) => (
                <option key={value} value={value} disabled={dialog === "receive" && value === "cash" && openShift === false}>{depositMethodLabels[value]}{dialog === "refund" ? ` · hasta ${formatMoney(held[value] ?? "0")}` : ""}</option>
              ))}
            </Select>
            {dialog === "receive" && openShift === false ? <p className="mt-1 text-xs text-muted-foreground">Abre un turno para recibir anticipos en efectivo.</p> : null}
          </div>
          <div>
            <Label htmlFor={ids.amount}>Monto</Label>
            <Input id={ids.amount} type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-describedby={`${ids.amount}-hint`} />
            <p id={`${ids.amount}-hint`} className="mt-1 text-xs text-muted-foreground">Máximo {formatMoney(moneyOf(limitCents))}</p>
          </div>
          <div>
            <Label htmlFor={ids.note}>{dialog === "refund" ? "Motivo" : "Referencia opcional"}</Label>
            <Input id={ids.note} value={note} maxLength={dialog === "refund" ? 200 : 255} required={dialog === "refund"} onChange={(event) => setNote(event.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>Volver</Button>
          <Button disabled={busy || !valid} onClick={submit}>{dialog === "refund" ? "Devolver" : "Registrar anticipo"}</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

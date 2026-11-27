import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { centsToMoney, moneyToCents } from "@/lib/money";
import { formatMoney } from "@/orders/format";
import { MAX_PEOPLE, MIN_PEOPLE } from "./splitBill";

export type SplitMethod = "cash" | "bank_transfer" | "manual_card";
export type PersonPayment = { method: SplitMethod; tendered: string; reference: string };

export const newPersonPayment = (method: SplitMethod = "bank_transfer"): PersonPayment => ({ method, tendered: "", reference: "" });

const methodLabels: Record<SplitMethod, string> = {
  cash: "Efectivo",
  bank_transfer: "Transferencia",
  manual_card: "Tarjeta manual",
};

export const personLabel = (person: number) => `Persona ${person + 1}`;

/** Every person with something to pay has a method; cash covers its part and needs an open drawer. */
export function splitBillReady(totals: number[], payments: PersonPayment[], cashAllowed: boolean): boolean {
  return totals.some((total) => total > 0) && totals.every((total, person) => {
    if (total <= 0) return true;
    const payment = payments[person];
    if (!payment) return false;
    if (payment.method !== "cash") return true;
    return cashAllowed && moneyToCents(payment.tendered) >= total;
  });
}

type Props = {
  idPrefix: string;
  lines: { key: string; name: string; detail?: string; quantity: number }[];
  owners: Record<string, number[]>;
  people: number;
  totals: number[];
  /** Already collected for each person (a pedido deposit share), shown for context. */
  credits?: number[];
  payments: PersonPayment[];
  cashAllowed: boolean;
  onPeopleChange: (people: number) => void;
  onAssign: (key: string, unit: number, person: number) => void;
  onPaymentChange: (person: number, patch: Partial<PersonPayment>) => void;
};

/** "Cada quien paga lo suyo": assign every unit to a person, then each pays their part. */
export function SplitBillPanel({ idPrefix, lines, owners, people, totals, credits, payments, cashAllowed, onPeopleChange, onAssign, onPaymentChange }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium" id={`${idPrefix}-people-label`}>Personas</span>
        <div className="flex items-center gap-2" role="group" aria-labelledby={`${idPrefix}-people-label`}>
          <Button type="button" size="icon" variant="outline" aria-label="Quitar una persona" disabled={people <= MIN_PEOPLE} onClick={() => onPeopleChange(people - 1)}><Minus className="h-4 w-4" /></Button>
          <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">{people}</span>
          <Button type="button" size="icon" variant="outline" aria-label="Agregar una persona" disabled={people >= MAX_PEOPLE} onClick={() => onPeopleChange(people + 1)}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">¿Quién consumió qué?</legend>
        {lines.flatMap((line) => (owners[line.key] ?? []).map((owner, unit) => {
          const id = `${idPrefix}-unit-${line.key}-${unit}`;
          return (
            <div key={id} className="grid grid-cols-[1fr_9rem] items-center gap-2 text-sm">
              <Label htmlFor={id} className="min-w-0 font-normal">
                <span className="block truncate">{line.name}{line.quantity > 1 ? ` (${unit + 1} de ${line.quantity})` : ""}</span>
                {line.detail ? <span className="block truncate text-xs text-muted-foreground">{line.detail}</span> : null}
              </Label>
              <Select id={id} value={String(owner)} onChange={(event) => onAssign(line.key, unit, Number(event.target.value))}>
                {Array.from({ length: people }, (_, person) => <option key={person} value={person}>{personLabel(person)}</option>)}
              </Select>
            </div>
          );
        }))}
      </fieldset>

      <div className="space-y-3">
        {totals.map((total, person) => {
          const payment = payments[person] ?? newPersonPayment();
          const methodId = `${idPrefix}-person-${person}-method`;
          const detailId = `${idPrefix}-person-${person}-detail`;
          const tenderedCents = moneyToCents(payment.tendered);
          return (
            <section key={person} aria-label={personLabel(person)} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{personLabel(person)}</h3>
                <span className="text-lg font-bold tabular-nums">{formatMoney(centsToMoney(total))}</span>
              </div>
              {credits?.[person] ? <p className="text-xs text-muted-foreground">Ya cubrió {formatMoney(centsToMoney(credits[person]))} con el anticipo.</p> : null}
              {total <= 0 ? <p className="text-xs text-muted-foreground">No tiene nada por pagar.</p> : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={methodId} className="text-xs">Paga con</Label>
                    <Select id={methodId} value={payment.method} onChange={(event) => onPaymentChange(person, { method: event.target.value as SplitMethod, tendered: "", reference: "" })}>
                      {(Object.keys(methodLabels) as SplitMethod[]).map((method) => (
                        <option key={method} value={method} disabled={method === "cash" && !cashAllowed}>{methodLabels[method]}</option>
                      ))}
                    </Select>
                  </div>
                  {payment.method === "cash" ? (
                    <div>
                      <Label htmlFor={detailId} className="text-xs">Efectivo recibido</Label>
                      <Input id={detailId} type="number" inputMode="decimal" min="0" step="0.01" value={payment.tendered} placeholder={centsToMoney(total)} onChange={(event) => onPaymentChange(person, { tendered: event.target.value })} />
                      {tenderedCents > total ? <p className="mt-1 text-xs text-muted-foreground">Cambio {formatMoney(centsToMoney(tenderedCents - total))}</p> : null}
                      {payment.tendered && tenderedCents < total ? <p className="mt-1 text-xs text-destructive">Falta {formatMoney(centsToMoney(total - tenderedCents))}</p> : null}
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor={detailId} className="text-xs">Referencia opcional</Label>
                      <Input id={detailId} value={payment.reference} maxLength={255} onChange={(event) => onPaymentChange(person, { reference: event.target.value })} />
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

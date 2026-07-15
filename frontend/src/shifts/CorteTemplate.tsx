import type { HTMLAttributes } from "react";
import { copy } from "@/i18n/messages";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/orders/format";
import type { Shift } from "./types";
import { formatShiftDateTime, localizeReconciliationStatus } from "./format";

type CorteTemplateProps = {
  businessName: string;
  shift: Shift;
} & HTMLAttributes<HTMLDivElement>;

function sumMovements(shift: Shift, type: string): number {
  return shift.movements
    .filter((movement) => movement.type === type)
    .reduce((total, movement) => total + Number(movement.amount), 0);
}

/**
 * Printable end-of-day cash count (corte de caja). All figures come from the
 * frozen closed-shift response so the printed corte ties exactly to the
 * on-screen reconciliation: cash sales are derived as the residual of the
 * documented formula (expected = opening + cash_sales + cash_in − cash_out −
 * refund_payout) rather than recomputed, so it can never drift from the frozen
 * expected value.
 */
export function CorteTemplate({ businessName, shift, className, ...containerProps }: CorteTemplateProps) {
  const opening = shift.opening_cash_amount ? Number(shift.opening_cash_amount) : 0;
  const cashIn = sumMovements(shift, "cash_in");
  const cashOut = sumMovements(shift, "cash_out");
  const refundPayout = sumMovements(shift, "refund_payout");
  const expected = shift.expected_cash_amount ? Number(shift.expected_cash_amount) : 0;
  const actual = shift.actual_cash_amount ? Number(shift.actual_cash_amount) : 0;
  const cashSales = expected - opening - cashIn + cashOut + refundPayout;
  const variance = shift.variance_amount != null ? Number(shift.variance_amount) : actual - expected;

  return (
    <div
      {...containerProps}
      className={cn(
        "corte-template rounded-[2px] p-4 font-mono text-[11px] leading-snug text-[color:var(--ticket-ink)]",
        className,
      )}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-semibold tracking-tight">{businessName}</p>
        <p className="tkt-caption text-[10px] uppercase tracking-wide">{copy.corte.title}</p>
      </div>

      <CorteSeparator />

      <div className="space-y-1">
        <CorteLine label={copy.corte.openedAt} value={formatShiftDateTime(shift.opened_at)} muted />
        <CorteLine
          label={copy.corte.closedAt}
          value={shift.closed_at ? formatShiftDateTime(shift.closed_at) : "—"}
          muted
        />
      </div>

      <CorteSeparator />

      <div className="space-y-1">
        <CorteLine label={copy.corte.openingCash} value={formatMoney(opening)} />
        <CorteLine label={copy.corte.cashSales} value={formatMoney(cashSales)} />
        {cashIn > 0 ? <CorteLine label={copy.corte.cashIn} value={`+${formatMoney(cashIn)}`} /> : null}
        {cashOut > 0 ? <CorteLine label={copy.corte.cashOut} value={`-${formatMoney(cashOut)}`} /> : null}
        {refundPayout > 0 ? (
          <CorteLine label={copy.corte.refundPayout} value={`-${formatMoney(refundPayout)}`} />
        ) : null}
      </div>

      <CorteSeparator />

      <div className="space-y-1">
        <CorteLine label={copy.corte.expectedCash} value={formatMoney(expected)} strong />
        <CorteLine label={copy.corte.actualCash} value={formatMoney(actual)} strong />
        <CorteLine
          label={copy.corte.variance}
          value={`${variance > 0 ? "+" : ""}${formatMoney(variance)}`}
          strong
        />
        <p className="tkt-caption text-right text-[10px]">
          {localizeReconciliationStatus(shift.reconciliation_status)}
        </p>
      </div>

      <CorteSeparator />
      <p className="tkt-caption text-center text-[10px]">{copy.corte.footer}</p>
    </div>
  );
}

function CorteSeparator() {
  return <div className="tkt-rule my-3" />;
}

function CorteLine({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-3 print:items-center",
        strong ? "tkt-total text-base font-bold print:justify-between" : "justify-between",
        muted && "tkt-caption",
      )}
    >
      <span>{label}</span>
      {strong ? <span className="tkt-leader print:hidden" aria-hidden="true" /> : null}
      <span className={cn(strong && "tkt-money")}>{value}</span>
    </div>
  );
}

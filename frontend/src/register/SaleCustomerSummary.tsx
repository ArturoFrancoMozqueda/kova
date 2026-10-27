import { UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SaleCustomerSummary({ name, disabled, onChange, onClear }: {
  name: string; disabled: boolean; onChange: () => void; onClear: () => void;
}) {
  return <section aria-label="Cliente de esta venta" className="flex min-w-0 items-start gap-3 rounded-xl border border-kova-blue/20 bg-kova-mist p-3">
    <UserRound className="mt-2 h-4 w-4 shrink-0 text-kova-blue" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="text-xs text-kova-muted">Cliente de esta venta</p><p className="break-words text-sm font-semibold">{name}</p>
      <Button type="button" variant="link" className="mt-1 h-auto min-h-11 whitespace-normal px-0 py-2 text-xs" aria-label="Cambiar cliente de la venta" disabled={disabled} onClick={onChange}>Cambiar cliente</Button>
    </div>
    <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Quitar cliente de la venta" disabled={disabled} onClick={onClear}><X className="h-4 w-4" aria-hidden="true" /></Button>
  </section>;
}

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_MENU_QUANTITY } from "./menu";

export function MenuQuantity({ name, quantity, disabled, onChange, fullWidth = false }: {
  name: string;
  quantity: number;
  disabled: boolean;
  onChange: (value: number) => void;
  fullWidth?: boolean;
}) {
  return <div role="group" aria-label={`Cantidad de ${name}`} className={`${fullWidth ? "flex w-full justify-between" : "inline-flex"} items-center rounded-xl border border-kova-border bg-white`}>
    <Button type="button" variant="ghost" size="icon" className="rounded-xl" aria-label={`Restar uno de ${name}`}
      disabled={disabled} onClick={() => onChange(quantity - 1)}><Minus aria-hidden="true" /></Button>
    <span className="min-w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-atomic="true"><span className="sr-only">Cantidad: </span>{quantity}</span>
    <Button type="button" variant="ghost" size="icon" className="rounded-xl" aria-label={`Agregar uno de ${name}`}
      disabled={disabled || quantity >= MAX_MENU_QUANTITY} onClick={() => onChange(quantity + 1)}><Plus aria-hidden="true" /></Button>
  </div>;
}

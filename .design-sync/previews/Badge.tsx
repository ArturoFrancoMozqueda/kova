import { Badge } from "pos-frontend";
import { AlertTriangle } from "lucide-react";

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3 p-6">
      <Badge>Pagada</Badge>
      <Badge variant="secondary">12 productos</Badge>
      <Badge variant="destructive">Cancelada</Badge>
      <Badge variant="outline">Sucursal Centro</Badge>
      <Badge variant="success">Turno abierto</Badge>
      <Badge variant="warning">Stock bajo</Badge>
    </div>
  );
}

export function OrderStatuses() {
  return (
    <div className="flex max-w-md flex-col gap-3 p-6">
      <div className="flex items-center justify-between text-sm text-kova-ink">
        <span className="tabular-nums">Ticket #1042 · $245.50</span>
        <Badge variant="success" className="text-sm">
          Pagada
        </Badge>
      </div>
      <div className="flex items-center justify-between text-sm text-kova-ink">
        <span className="tabular-nums">Ticket #1041 · $118.00</span>
        <Badge variant="warning" className="text-sm">
          Reembolso parcial
        </Badge>
      </div>
      <div className="flex items-center justify-between text-sm text-kova-ink">
        <span className="tabular-nums">Ticket #1039 · $560.00</span>
        <Badge variant="destructive" className="text-sm">
          Cancelada
        </Badge>
      </div>
    </div>
  );
}

export function InventoryAlerts() {
  return (
    <div className="flex flex-wrap items-center gap-3 p-6">
      <Badge variant="warning" className="gap-1.5 px-3 py-1 text-sm">
        <AlertTriangle className="h-3.5 w-3.5" />3 productos con stock bajo
      </Badge>
      <Badge variant="destructive">Agotado</Badge>
      <Badge variant="secondary">Merma</Badge>
      <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
        Requiere costo
      </Badge>
    </div>
  );
}

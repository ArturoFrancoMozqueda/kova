import { Input, Label } from "pos-frontend";
import { Search } from "lucide-react";

export function Canonical() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Label htmlFor="product-name">Nombre del producto</Label>
      <Input id="product-name" defaultValue="Concha de vainilla" placeholder="Ej. Café americano" />
    </div>
  );
}

export function MoneyAmount() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Label htmlFor="movement-amount">Monto</Label>
      <Input
        id="movement-amount"
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0.01"
        defaultValue="150.00"
        placeholder="0.00"
      />
      <p className="text-xs text-kova-muted">Se registrará como entrada de efectivo en el turno.</p>
    </div>
  );
}

export function SearchField() {
  return (
    <div className="max-w-sm p-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kova-tertiary" />
        <Input placeholder="Buscar producto o SKU…" className="pl-9" aria-label="Buscar en inventario" />
      </div>
    </div>
  );
}

export function ErrorState() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Label htmlFor="stock-quantity">Cantidad a ajustar</Label>
      <Input
        id="stock-quantity"
        type="number"
        inputMode="decimal"
        defaultValue="-5"
        aria-invalid
        aria-describedby="stock-quantity-error"
        className="border-destructive focus-visible:ring-destructive"
      />
      <p id="stock-quantity-error" className="text-sm text-destructive">
        La cantidad debe ser mayor a cero.
      </p>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Label htmlFor="branch-name">Sucursal</Label>
      <Input id="branch-name" defaultValue="Sucursal Centro" disabled />
      <p className="text-xs text-kova-muted">Solo el administrador puede cambiar la sucursal.</p>
    </div>
  );
}

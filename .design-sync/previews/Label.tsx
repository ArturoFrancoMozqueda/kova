import { Badge, Input, Label, Select } from "pos-frontend";

export function FieldLabel() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Label htmlFor="customer-name">Nombre del cliente</Label>
      <Input id="customer-name" placeholder="Ej. María González" />
    </div>
  );
}

export function RequiredField() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <div className="flex items-center gap-2">
        <Label htmlFor="sale-price">Precio de venta</Label>
        <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
          Obligatorio
        </Badge>
      </div>
      <Input id="sale-price" type="number" inputMode="decimal" step="0.01" placeholder="0.00" />
    </div>
  );
}

export function FormRow() {
  return (
    <div className="grid max-w-lg grid-cols-2 gap-4 p-6">
      <div className="space-y-2">
        <Label htmlFor="expense-category">Categoría del gasto</Label>
        <Select id="expense-category" defaultValue="insumos">
          <option value="insumos">Insumos</option>
          <option value="renta">Renta</option>
          <option value="servicios">Servicios</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="expense-amount">Monto</Label>
        <Input id="expense-amount" type="number" inputMode="decimal" step="0.01" placeholder="0.00" />
      </div>
    </div>
  );
}

export function DisabledPeer() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Input id="tax-id" className="peer" defaultValue="KOV210522AB1" disabled />
      <Label htmlFor="tax-id">RFC del negocio (solo lectura)</Label>
    </div>
  );
}

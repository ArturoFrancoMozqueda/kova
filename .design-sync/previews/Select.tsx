import { Input, Label, Select } from "pos-frontend";

export function Canonical() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Label htmlFor="void-reason">Motivo de cancelación</Label>
      <Select id="void-reason" defaultValue="captura">
        <option value="captura">Error de captura</option>
        <option value="cliente">El cliente cambió de opinión</option>
        <option value="duplicado">Ticket duplicado</option>
        <option value="otro">Otro</option>
      </Select>
    </div>
  );
}

export function MovementForm() {
  return (
    <div className="max-w-sm space-y-4 p-6">
      <div className="space-y-2">
        <Label htmlFor="movement-type">Tipo de movimiento</Label>
        <Select id="movement-type" defaultValue="cash_in">
          <option value="cash_in">Entrada de efectivo</option>
          <option value="cash_out">Salida de efectivo</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="movement-concept">Concepto</Label>
        <Input id="movement-concept" placeholder="Ej. Cambio para caja" />
      </div>
    </div>
  );
}

export function FilterRow() {
  return (
    <div className="flex max-w-lg flex-wrap items-end gap-3 p-6">
      <div className="min-w-40 flex-1 space-y-2">
        <Label htmlFor="filter-status">Estado</Label>
        <Select id="filter-status" defaultValue="all">
          <option value="all">Todas las ventas</option>
          <option value="paid">Pagadas</option>
          <option value="refunded">Reembolsadas</option>
          <option value="voided">Canceladas</option>
        </Select>
      </div>
      <div className="min-w-40 flex-1 space-y-2">
        <Label htmlFor="filter-payment">Método de pago</Label>
        <Select id="filter-payment" defaultValue="cash">
          <option value="cash">Efectivo</option>
          <option value="card">Tarjeta</option>
          <option value="transfer">Transferencia</option>
        </Select>
      </div>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="max-w-sm space-y-2 p-6">
      <Label htmlFor="employee-role">Rol del empleado</Label>
      <Select id="employee-role" defaultValue="cajero" disabled>
        <option value="cajero">Cajero</option>
        <option value="gerente">Gerente</option>
      </Select>
      <p className="text-xs text-kova-muted">La invitación está pendiente de aceptación.</p>
    </div>
  );
}

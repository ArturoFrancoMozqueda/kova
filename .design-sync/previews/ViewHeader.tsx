import { Badge, Button, Select, ViewHeader } from "pos-frontend";
import { Plus } from "lucide-react";

export function WithActions() {
  return (
    <div className="max-w-2xl p-6">
      <ViewHeader
        eyebrow="Inventario"
        title="Productos"
        actions={
          <Button size="sm">
            <Plus />
            Agregar producto
          </Button>
        }
        meta="128 productos activos · Sucursal Centro"
      />
    </div>
  );
}

export function WithFilters() {
  return (
    <div className="max-w-2xl p-6">
      <ViewHeader
        title="Reportes"
        actions={
          <div className="flex items-center gap-2">
            <Select defaultValue="7d" className="w-40">
              <option value="7d">Últimos 7 días</option>
              <option value="30d">Últimos 30 días</option>
            </Select>
            <Badge variant="success">Al día</Badge>
          </div>
        }
        meta="Zona horaria: America/Mexico_City"
      />
    </div>
  );
}

export function TitleOnly() {
  return (
    <div className="max-w-2xl p-6">
      <ViewHeader title="Configuración" />
    </div>
  );
}

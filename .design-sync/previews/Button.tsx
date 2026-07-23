import { Button } from "pos-frontend";
import { CreditCard, Plus, Printer, Trash2 } from "lucide-react";

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3 p-6">
      <Button>Cobrar</Button>
      <Button variant="secondary">Guardar borrador</Button>
      <Button variant="outline">Imprimir ticket</Button>
      <Button variant="ghost">Cancelar</Button>
      <Button variant="destructive">Eliminar venta</Button>
      <Button variant="link">Ver detalle</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3 p-6">
      <Button size="sm" variant="outline">
        Pequeño
      </Button>
      <Button>Mediano</Button>
      <Button size="lg">Grande</Button>
      <Button size="xl">
        <CreditCard />
        Cobrar $245.50
      </Button>
      <Button size="icon" variant="outline" aria-label="Agregar producto">
        <Plus />
      </Button>
    </div>
  );
}

export function States() {
  return (
    <div className="flex flex-wrap items-center gap-3 p-6">
      <Button>
        <Printer />
        Imprimir
      </Button>
      <Button disabled>Procesando…</Button>
      <Button variant="destructive" disabled>
        <Trash2 />
        Eliminar
      </Button>
    </div>
  );
}

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "pos-frontend";

export function EditProduct() {
  return (
    // The transform makes the Dialog's fixed overlay position against this
    // wrapper instead of the browser viewport, so the open state renders
    // inside the preview card.
    <div style={{ transform: "translateZ(0)", height: 540, overflow: "hidden" }}>
      {/* Deterministic capture: skip entry animations (fade/scale start at opacity 0). */}
      <style>{"[role=presentation], [role=presentation] * { animation: none !important; }"}</style>
      <Dialog open onClose={() => {}}>
      <DialogHeader>
        <DialogTitle>Editar producto</DialogTitle>
        <DialogDescription>
          Los cambios se aplican de inmediato en el punto de venta.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="dlg-nombre">Nombre</Label>
          <Input id="dlg-nombre" defaultValue="Café americano" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dlg-precio">Precio</Label>
          <Input id="dlg-precio" type="number" step="0.01" defaultValue="45.00" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline">Cancelar</Button>
        <Button>Guardar cambios</Button>
      </DialogFooter>
      </Dialog>
    </div>
  );
}

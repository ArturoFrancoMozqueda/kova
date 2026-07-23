import { ConfirmDialog } from "pos-frontend";

export function DeleteProduct() {
  return (
    // The transform makes the Dialog's fixed overlay position against this
    // wrapper instead of the browser viewport, so the open state renders
    // inside the preview card.
    <div style={{ transform: "translateZ(0)", height: 400, overflow: "hidden" }}>
      {/* Deterministic capture: skip entry animations (fade/scale start at opacity 0). */}
      <style>{"[role=presentation], [role=presentation] * { animation: none !important; }"}</style>
      <ConfirmDialog
        open
        title="¿Eliminar producto?"
        description="“Concha de vainilla” se quitará del catálogo. Las ventas anteriores no se modifican."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </div>
  );
}

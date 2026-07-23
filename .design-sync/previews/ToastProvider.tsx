import { useEffect } from "react";
import { Card, ToastProvider, useToast } from "pos-frontend";

/** Fires long-lived toasts on mount so the static capture shows the stack. */
function FireToasts() {
  const { toast } = useToast();
  useEffect(() => {
    toast("Venta registrada por $245.50", { variant: "success", durationMs: 60000 });
    toast("Sin conexión — la venta se guardó y se sincronizará", {
      variant: "warning",
      durationMs: 60000,
    });
    toast("No se pudo imprimir el ticket", {
      variant: "error",
      action: { label: "Reintentar", onAction: () => {} },
      durationMs: 60000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Card className="p-5">
      <p className="text-sm text-kova-muted">
        Las notificaciones aparecen apiladas en la esquina de la pantalla.
      </p>
    </Card>
  );
}

export function ToastVariants() {
  return (
    <ToastProvider>
      <div className="min-h-[320px] p-6">
        <FireToasts />
      </div>
    </ToastProvider>
  );
}

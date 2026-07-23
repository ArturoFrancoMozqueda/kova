import { ViewPermissionDenied } from "pos-frontend";

export function Denied() {
  return (
    <div className="max-w-2xl">
      <ViewPermissionDenied
        title="No tienes acceso a Reportes"
        description="Pide al administrador del negocio que actualice tu rol para ver esta sección."
      />
    </div>
  );
}

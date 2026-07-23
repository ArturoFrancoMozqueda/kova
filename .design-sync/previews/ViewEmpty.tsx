import { ViewEmpty } from "pos-frontend";
import { Package, Receipt } from "lucide-react";

export function WithCtas() {
  return (
    <div className="max-w-2xl p-6">
      <ViewEmpty
        icon={<Package className="h-6 w-6" />}
        title="Aún no tienes productos"
        body="Agrega tu primer producto para empezar a vender. Puedes importar tu catálogo o crearlos uno por uno."
        primaryCta={{ label: "Agregar producto", onClick: () => {} }}
        secondaryCta={{ label: "Importar catálogo", onClick: () => {} }}
      />
    </div>
  );
}

export function Bare() {
  return (
    <div className="max-w-2xl p-6">
      <ViewEmpty
        bare
        icon={<Receipt className="h-6 w-6" />}
        title="Sin ventas en este periodo"
        body="Cuando registres ventas, aparecerán aquí con su desglose por método de pago."
      />
    </div>
  );
}

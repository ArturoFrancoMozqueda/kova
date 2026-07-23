import { DeltaChip, StatTile } from "pos-frontend";
import { Banknote, Receipt, Undo2 } from "lucide-react";

export function KpiRow() {
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4 p-6 sm:grid-cols-3">
      <StatTile
        label="Ventas de hoy"
        value="$8,420.00"
        icon={<Banknote className="h-4 w-4" />}
      >
        <DeltaChip
          growth={{ kind: "pct", value: 12.4 }}
          current={8420}
          previous={7490}
          format="money"
          compareLabel="vs ayer"
        />
      </StatTile>
      <StatTile label="Tickets" value="37" icon={<Receipt className="h-4 w-4" />}>
        <DeltaChip
          growth={{ kind: "pct", value: -8.1 }}
          current={37}
          previous={40}
          format="count"
          compareLabel="vs ayer"
        />
      </StatTile>
      <StatTile label="Devoluciones" value="$150.00" icon={<Undo2 className="h-4 w-4" />}>
        <DeltaChip
          growth={{ kind: "pct", value: 25 }}
          current={150}
          previous={120}
          format="money"
          positiveIsGood={false}
        />
      </StatTile>
    </div>
  );
}

export function DeltaStates() {
  return (
    <div className="grid max-w-3xl grid-cols-1 gap-4 p-6 sm:grid-cols-3">
      <StatTile label="Nuevo negocio" value="$1,240.00" icon={<Banknote className="h-4 w-4" />}>
        <DeltaChip growth={{ kind: "new" }} current={1240} previous={0} format="money" />
      </StatTile>
      <StatTile label="Sin historial" value="12" icon={<Receipt className="h-4 w-4" />}>
        <DeltaChip growth={{ kind: "no-previous" }} current={12} previous={0} format="count" />
      </StatTile>
      <StatTile label="Sin cambio" value="$980.00" icon={<Banknote className="h-4 w-4" />}>
        <DeltaChip
          growth={{ kind: "flat" }}
          current={980}
          previous={980}
          format="money"
          compareLabel="vs ayer"
        />
      </StatTile>
    </div>
  );
}

import { DeltaChip } from "pos-frontend";

export function AllStates() {
  return (
    <div className="flex max-w-md flex-col gap-3 p-6 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-kova-muted">Crecimiento</span>
        <DeltaChip
          growth={{ kind: "pct", value: 12.4 }}
          current={8420}
          previous={7490}
          format="money"
          compareLabel="vs ayer"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-kova-muted">Caída</span>
        <DeltaChip
          growth={{ kind: "pct", value: -8.1 }}
          current={37}
          previous={40}
          format="count"
          compareLabel="vs ayer"
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-kova-muted">Malo aunque sube (devoluciones)</span>
        <DeltaChip
          growth={{ kind: "pct", value: 25 }}
          current={150}
          previous={120}
          format="money"
          positiveIsGood={false}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-kova-muted">Nuevo</span>
        <DeltaChip growth={{ kind: "new" }} current={1240} previous={0} format="money" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-kova-muted">Sin comparación</span>
        <DeltaChip growth={{ kind: "no-previous" }} current={12} previous={0} format="count" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-kova-muted">Sin cambio</span>
        <DeltaChip
          growth={{ kind: "flat" }}
          current={980}
          previous={980}
          format="money"
          compareLabel="vs ayer"
        />
      </div>
    </div>
  );
}

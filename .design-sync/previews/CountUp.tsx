import { CountUp } from "pos-frontend";

const money = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

export function MoneyAndCount() {
  return (
    <div className="flex items-baseline gap-10 p-6">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">
          Ventas de hoy
        </p>
        <p className="text-2xl font-bold text-kova-ink">
          <CountUp value={8420} format={money} />
        </p>
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-kova-tertiary">
          Tickets
        </p>
        <p className="text-2xl font-bold text-kova-ink">
          <CountUp value={37} format={(n) => String(Math.round(n))} />
        </p>
      </div>
    </div>
  );
}

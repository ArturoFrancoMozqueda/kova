import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
export function dateKey(value: Date, timezone = "America/Mexico_City") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
}
export const addDays = (value: string, count: number) => {
  const day = new Date(`${value}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
};
export function DatePicker({
  value,
  onChange,
  min,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  min: string;
  max: string;
}) {
  const [month, setMonth] = useState(() => (value || min).slice(0, 7));
  const first = new Date(`${month}-01T12:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(
    first.getUTCFullYear(),
    first.getUTCMonth() + 1,
    0,
  ).getDate();
  const monthLabel = new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(first);
  const shift = (n: number) => {
    const date = new Date(first);
    date.setUTCMonth(date.getUTCMonth() + n);
    setMonth(date.toISOString().slice(0, 7));
  };
  return (
    <section aria-label="Elegir día" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold" aria-live="polite">
          {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
        </h2>
        <div className="flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mes anterior"
            disabled={month <= min.slice(0, 7)}
            onClick={() => shift(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mes siguiente"
            disabled={month >= max.slice(0, 7)}
            onClick={() => shift(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["L", "M", "M", "J", "V", "S", "D"].map((label, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="py-2 text-xs text-kova-muted"
          >
            {label}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`empty-${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const day = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              key={day}
              type="button"
              aria-label={new Intl.DateTimeFormat("es-MX", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }).format(new Date(`${day}T12:00:00Z`))}
              aria-pressed={value === day}
              disabled={day < min || day > max}
              onClick={() => onChange(day)}
              className={`min-h-11 min-w-0 rounded-full text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue disabled:opacity-25 ${value === day ? "bg-kova-blue text-white" : "hover:bg-kova-mist"}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </section>
  );
}

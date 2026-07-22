import type { KeyboardEventHandler, ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/orders/format";

export type RegisterProductCardProps = {
  name: string;
  price: string | number;
  image?: ReactNode;
  status?: { label: string; tone: "muted" | "warning" };
  quantity?: number;
  disabled?: boolean;
  onAdd?: () => void;
  onDisabledSelect?: () => void;
  ariaLabel: string;
  compact?: boolean;
};

/** Product tile shared by the live register and the public local demo. */
export function RegisterProductCard({
  name,
  price,
  image,
  status,
  quantity,
  disabled = false,
  onAdd,
  onDisabledSelect,
  ariaLabel,
  compact = false,
}: RegisterProductCardProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={disabled ? onDisabledSelect : onAdd}
      className={cn(
        "group relative flex items-stretch gap-3 rounded-xl border bg-card p-2.5 text-left shadow-kova-card transition-all hover:border-primary/40 hover:shadow-kova-card-hover active:scale-[0.97]",
        !compact && "sm:flex-col sm:justify-between sm:gap-0 sm:p-3",
        disabled && "cursor-not-allowed opacity-60 hover:border-border hover:shadow-kova-card active:scale-100",
      )}
    >
      <div className={cn("flex flex-1 min-w-0 items-center gap-3", !compact && "sm:block sm:space-y-2")}>
        {image}
        <div className="flex min-w-0 flex-1 items-start justify-between gap-1">
          <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug transition-colors group-hover:text-primary">
            {name}
          </p>
          {status ? (
            <span className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              status.tone === "warning" ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground",
            )}>
              {status.label}
            </span>
          ) : null}
        </div>
      </div>
      <div className={cn("flex shrink-0 items-center gap-2", !compact && "sm:mt-3 sm:justify-between")}>
        <span className="tabular-nums text-base font-bold text-primary">{formatMoney(price)}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary opacity-70 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
          <Plus className="h-3.5 w-3.5" />
        </span>
      </div>
      {quantity ? (
        <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums">
          {quantity}
        </span>
      ) : null}
    </button>
  );
}

export type RegisterPaymentOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onDisabledSelect?: () => void;
};

export function RegisterPaymentMethodSelector<T extends string>({
  value,
  options,
  onChange,
  label,
  compact = false,
  labelledBy,
  onKeyDown,
}: {
  value: T;
  options: readonly RegisterPaymentOption<T>[];
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  labelledBy?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="radiogroup"
      tabIndex={-1}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-radio-value={option.value}
            tabIndex={selected ? 0 : -1}
            aria-checked={selected}
            aria-disabled={option.disabled || undefined}
            onClick={() => option.disabled ? option.onDisabledSelect?.() : onChange(option.value)}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 text-xs font-medium transition-all",
              compact ? "min-h-10 py-1.5" : "min-h-[60px] py-3",
              option.disabled
                ? "cursor-not-allowed border-kova-border bg-muted/40 text-muted-foreground/50"
                : selected
                  ? "border-kova-blue bg-kova-blue/5 text-kova-blue shadow-sm"
                  : "border-kova-border text-kova-muted hover:border-kova-blue/40 hover:text-kova-ink",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

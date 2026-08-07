import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { handleRadioGroupKeyDown } from "@/lib/radiogroup";

export type SegmentedControlOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onValueChange,
  selectionMode = "radio",
  children,
  className,
}: {
  ariaLabel: string;
  options: readonly SegmentedControlOption<T>[];
  value: T | null;
  onValueChange: (value: T) => void;
  selectionMode?: "radio" | "button";
  children?: ReactNode;
  className?: string;
}) {
  const firstEnabledValue = options.find((option) => !option.disabled)?.value;
  const tabStopValue = value ?? firstEnabledValue;
  const isRadioGroup = selectionMode === "radio";

  return (
    <div className={cn("inline-flex self-start rounded-kova-md bg-kova-mist p-1", className)}>
      <div
        role={isRadioGroup ? "radiogroup" : "group"}
        aria-label={ariaLabel}
        tabIndex={isRadioGroup ? -1 : undefined}
        className="flex"
        onKeyDown={(event) => {
          if (!isRadioGroup || !tabStopValue) return;
          handleRadioGroupKeyDown(event, options, value ?? tabStopValue, onValueChange);
        }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role={isRadioGroup ? "radio" : undefined}
            data-radio-value={isRadioGroup ? option.value : undefined}
            aria-checked={isRadioGroup ? value === option.value : undefined}
            aria-pressed={!isRadioGroup ? value === option.value : undefined}
            disabled={option.disabled}
            tabIndex={isRadioGroup ? (tabStopValue === option.value ? 0 : -1) : undefined}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "h-8 rounded-kova-sm px-4 text-xs font-medium text-kova-ink transition-colors duration-quick ease-standard",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2",
              value === option.value
                ? "bg-white shadow-sm hover:bg-white"
                : "text-muted-foreground hover:bg-white/70 hover:text-kova-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

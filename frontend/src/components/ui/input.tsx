import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, inputMode, ...props }, ref) => {
    const isMoney = type === "number" && (props.step === "0.01" || (props as { ["data-money"]?: unknown })["data-money"] !== undefined);
    return (
      <input
        type={type}
        inputMode={inputMode ?? (isMoney ? "decimal" : undefined)}
        className={cn(
          "flex h-11 w-full rounded-kova-md border-[0.5px] border-kova-border bg-transparent px-3 py-1 text-sm text-kova-ink shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-kova-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue disabled:cursor-not-allowed disabled:opacity-50",
          isMoney && "tabular-nums",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

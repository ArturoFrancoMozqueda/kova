import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => {
    return (
      <select
        className={cn(
          // box-shadow included so the focus ring fades in — see input.tsx.
          "flex h-11 w-full rounded-kova-md border-[0.5px] border-kova-border bg-transparent px-3 py-1 text-sm text-kova-ink shadow-sm transition-[color,border-color,box-shadow] duration-quick ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Select.displayName = "Select";

export { Select };

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-24 w-full resize-y rounded-kova-md border-[0.5px] border-kova-border bg-transparent px-3 py-2 text-sm text-kova-ink shadow-sm transition-[color,border-color,box-shadow] duration-quick ease-standard placeholder:text-kova-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };

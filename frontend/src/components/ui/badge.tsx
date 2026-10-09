import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // No transition: a Badge is a non-interactive <div> whose colours never change.
  "inline-flex items-center rounded-full border-[0.5px] px-2.5 py-0.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-kova-blue focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-kova-ink text-white",
        secondary: "border-transparent bg-kova-mist text-kova-ink",
        destructive: "border-transparent bg-kova-danger text-kova-danger-foreground",
        outline: "text-kova-ink border-kova-border",
        success: "border-transparent bg-kova-growth/15 text-emerald-700",
        warning: "border-transparent bg-warning/20 text-warning-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

import { useId, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { MOTION_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";
import { Button, type ButtonProps } from "./button";

/**
 * Accessible disclosure adapted from ddoemonn/accordion on 21st.dev.
 * Kova keeps the source component's labelled region, inert exit state, and
 * animated chevron, but uses the product motion tokens instead of motion/react.
 */
export function Disclosure({
  open,
  onOpenChange,
  trigger,
  children,
  className,
  triggerClassName,
  panelClassName,
  variant = "ghost",
  size = "sm",
  showChevron = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  showChevron?: boolean;
}) {
  const id = useId();
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;
  const presence = usePresence(open, MOTION_MS.panelExit);

  return (
    <div className={className}>
      <Button
        id={triggerId}
        type="button"
        variant={variant}
        size={size}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className={triggerClassName}
      >
        <span>{trigger}</span>
        {showChevron ? (
          <ChevronDown
            aria-hidden
            className={cn(
              "transition-transform duration-quick ease-standard",
              open && "rotate-180",
            )}
          />
        ) : null}
      </Button>

      {presence.mounted ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          {...(presence.exiting
            ? ({ "aria-hidden": true, inert: "" } as HTMLAttributes<HTMLDivElement>)
            : {})}
          className={cn(
            presence.exiting ? "animate-fade-out" : "animate-fade-in",
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

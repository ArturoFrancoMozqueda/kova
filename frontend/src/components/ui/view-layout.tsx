import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ViewLayoutWidth = "wide" | "standard" | "focused";

const WIDTH_CLASSES: Record<ViewLayoutWidth, string> = {
  wide: "max-w-7xl",
  standard: "max-w-6xl",
  focused: "max-w-5xl",
};

type ViewLayoutProps<T extends ElementType = "main"> = {
  as?: T;
  width?: ViewLayoutWidth;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

/**
 * Shared geometry for authenticated views. Keeping ready/loading/error states
 * in this same frame prevents the content from jumping between route states.
 */
export function ViewLayout<T extends ElementType = "main">({
  as,
  width = "standard",
  className,
  children,
  ...props
}: ViewLayoutProps<T>) {
  const Component = as ?? "main";
  return (
    <Component
      className={cn(
        "mx-auto w-full flex-1 p-4 sm:p-6 lg:p-8",
        WIDTH_CLASSES[width],
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

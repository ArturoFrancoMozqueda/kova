import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Tinted icon tile for form and settings section headings, same as the Panel's quick actions. */
export function SectionHeadingIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-kova-blue/10 text-kova-blue", className)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

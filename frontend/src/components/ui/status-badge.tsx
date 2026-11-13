import { Badge, type BadgeProps } from "./badge";
import { cn } from "@/lib/utils";
import { semanticIcon, type SemanticDomain, type SemanticTone } from "./semantic-icons";

const variantByTone: Record<SemanticTone, NonNullable<BadgeProps["variant"]>> = {
  neutral: "secondary",
  info: "secondary",
  success: "success",
  warning: "warning",
  danger: "destructive",
};

/**
 * Icon + text badge for a known business state. The label is always visible
 * text; the icon is decorative and only helps scanning.
 */
export function StatusBadge({
  domain,
  value,
  label,
  className,
}: {
  domain: SemanticDomain;
  value: string | null | undefined;
  label: string;
  className?: string;
}) {
  const { icon: Icon, tone } = semanticIcon(domain, value);
  return (
    <Badge variant={variantByTone[tone]} className={cn("gap-1", className)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** Inline icon + text for secondary facts (delivery type, promised time). */
export function SemanticLabel({ domain, value, label, className }: {
  domain: SemanticDomain;
  value: string | null | undefined;
  label: string;
  className?: string;
}) {
  const { icon: Icon } = semanticIcon(domain, value);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

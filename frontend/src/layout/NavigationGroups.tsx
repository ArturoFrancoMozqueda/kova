import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { readExpandedNavigationGroups, type WorkspaceGroupId } from "./workspaceNavigation";

type NavigationGroup<T> = { id: WorkspaceGroupId; label: string; icon: ReactNode; items: readonly T[] };

export function NavigationGroups<T>({ groups, activeGroup, pathname, storageKey, compact, onExpand, renderItem }: {
  groups: readonly NavigationGroup<T>[];
  activeGroup: WorkspaceGroupId | undefined;
  pathname: string;
  storageKey: string;
  compact: boolean;
  onExpand: () => void;
  renderItem: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(() => ({
    ...readExpandedNavigationGroups(storageKey),
    ...(activeGroup ? { [activeGroup]: true } : {}),
  }));

  useEffect(() => {
    if (activeGroup) setExpanded(current => current[activeGroup] ? current : { ...current, [activeGroup]: true });
  }, [activeGroup, pathname]);

  const toggle = (id: WorkspaceGroupId) => {
    const next = { ...expanded, [id]: compact || !expanded[id] };
    setExpanded(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { /* Navigation remains usable when preferences cannot be saved. */ }
    if (compact) onExpand();
  };

  return <div className="mt-4 space-y-1 border-t border-sidebar-border pt-3">
    {!compact && <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-muted">Secciones del negocio</p>}
    {groups.map(group => {
      if (group.items.length === 1) return <div key={group.id}>{renderItem(group.items[0])}</div>;
      const open = !compact && Boolean(expanded[group.id]);
      const panelId = `navigation-group-${group.id}`;
      return <div key={group.id}>
        <button type="button" aria-label={group.label} title={compact ? group.label : undefined}
          aria-expanded={open} aria-controls={panelId} onClick={() => toggle(group.id)}
          className={cn("relative flex min-h-11 w-full items-center gap-3 rounded-kova-md px-2.5 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue-light",
            compact && "justify-center",
            activeGroup === group.id ? "bg-sidebar-accent/60 text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground")}
        >
          <span aria-hidden="true" className="shrink-0">{group.icon}</span>
          {!compact && <span className="min-w-0 flex-1 break-words">{group.label}</span>}
          <ChevronDown aria-hidden="true" className={cn("shrink-0 text-sidebar-muted transition-transform", compact ? "absolute bottom-1 right-1 h-2.5 w-2.5" : "h-4 w-4", open && "rotate-180")} />
        </button>
        <div id={panelId} hidden={!open} className="ml-4 space-y-1 border-l border-sidebar-border py-1 pl-2">
          {group.items.map(renderItem)}
        </div>
      </div>;
    })}
  </div>;
}

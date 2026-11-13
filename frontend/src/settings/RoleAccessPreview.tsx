import { useAuth } from "@/auth/useAuth";
import { permissionsForRole } from "@/auth/permissions";
import { hasPlanFeature } from "@/billing/entitlements";
import { LivePreview } from "@/components/ui/live-preview";
import { visibleNavItems, workspaceGroupLabels } from "@/layout/navItems";
import { buildWorkspaceNavigation, primaryNavigationPaths } from "@/layout/workspaceNavigation";

/**
 * The sidebar a person with `role` will get in this business, computed with
 * the same rules as AppShell. It illustrates access; the server still decides.
 */
export function RoleAccessPreview({ role, roleLabel }: { role: string; roleLabel: string }) {
  const { state } = useAuth();
  const session = state.status === "authenticated" ? state : null;
  // Same rule as useFeature, read from the session already provided by useAuth.
  const marginReportsEnabled = session?.featureFlags?.margin_reports === true;
  const customerOrdersEnabled = session?.featureFlags?.customer_orders === true;
  const access = session?.commercialAccess;
  const permissions = permissionsForRole(role);
  const items = visibleNavItems({
    role,
    can: (permission) => permissions.has(permission),
    offline: false,
    commercialBlocked: false,
    // The assistant depends on a separate live check; it is never shown as a promise here.
    assistantEnabled: false,
    advancedReports: hasPlanFeature(access, "advanced_reports"),
    marginReportsEnabled,
    customerOrdersEnabled,
  });
  const primary = primaryNavigationPaths.flatMap(path => items.filter(item => item.to === path));
  const groups = buildWorkspaceNavigation(items);
  const labels = [...primary, ...groups.flatMap(group => group.items)].map(item => item.label);
  return (
    <LivePreview
      label={`Vista previa del menú de ${roleLabel}`}
      title={`Lo que verá: ${roleLabel}`}
      summary={`Una persona con rol ${roleLabel} verá ${labels.length} secciones: ${labels.join(", ")}.`}
      note={<p>Así se ve el menú lateral de esta persona en Kova. Los permisos también se validan en el servidor.</p>}
    >
      <div className="rounded-2xl border border-kova-ink-border bg-kova-ink p-3 text-sm text-white shadow-kova-card">
        <ul className="space-y-0.5">
          {primary.map(item => (
            <li key={item.to} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-white/70">
              {item.icon}<span className="truncate">{item.label}</span>
            </li>
          ))}
        </ul>
        {groups.map(group => (
          <div key={group.id} className="mt-3 border-t border-white/10 pt-2">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/60">{workspaceGroupLabels[group.id]}</p>
            <ul className="space-y-0.5">
              {group.items.map(item => (
                <li key={item.to} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-white/90 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-white/60">
                  {item.icon}<span className="truncate">{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </LivePreview>
  );
}

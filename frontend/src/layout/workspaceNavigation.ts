export type WorkspaceGroupId = "sales" | "customers" | "operation" | "analysis" | "settings";

/** Already filtered by AppShell's role, feature, capability and session gates. */
export type WorkspaceNavigationContext = {
  destinations: readonly { to: string; label: string }[];
};

// These are navigation scopes, not access rules. AppShell supplies only the
// destinations already allowed by role, feature, permission and session mode.
export const workspaceGroups: readonly { id: WorkspaceGroupId; paths: readonly string[] }[] = [
  { id: "sales", paths: ["/orders", "/pedidos", "/quotes", "/shifts"] },
  { id: "customers", paths: ["/customers", "/settings/public-catalog", "/commercial-requests", "/crm", "/inbox", "/appointments", "/service-cases", "/followups", "/loyalty"] },
  { id: "operation", paths: ["/operations-queue", "/catalog", "/inventory", "/purchasing", "/replenishment"] },
  { id: "analysis", paths: ["/reports", "/expenses", "/reconciliation", "/assistant"] },
  { id: "settings", paths: ["/settings", "/automations", "/settings/billing", "/settings/integrations", "/settings/channels"] },
];

export function workspaceGroupForPath(pathname: string): WorkspaceGroupId | undefined {
  // Prefer the most specific route: the public catalog belongs to Customers,
  // while the rest of /settings belongs to Configuration.
  return workspaceGroups.flatMap(group => group.paths.map(path => ({ id: group.id, path })))
    .filter(item => pathname === item.path || pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.id;
}

export function buildWorkspaceNavigation<T extends { to: string }>(destinations: readonly T[]) {
  return workspaceGroups.flatMap(group => {
    const items = group.paths.flatMap(path => destinations.filter(item => item.to === path));
    return items.length ? [{ id: group.id, destination: items[0], items }] : [];
  });
}

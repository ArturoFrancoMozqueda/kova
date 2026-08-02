import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { copy } from "@/i18n/messages";
import { useAuth } from "@/auth/useAuth";
import { useFeature } from "@/auth/useFeature";
import { usePermission, REPORTS_VIEW_ALL_PERMISSION, BILLING_VIEW_PERMISSION, EXPENSES_MANAGE_PERMISSION } from "@/auth/permissions";
import {
  ShoppingCart,
  LayoutGrid,
  ClipboardList,
  Package,
  Clock,
  BarChart3,
  CreditCard,
  WalletCards,
  Settings,
  LogOut,
  LayoutDashboard,
  ChevronRight,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";
import { avatarColorFor } from "@/lib/avatarColor";
import { OfflineIndicator } from "@/offline/OfflineIndicator";
import { LogoMark } from "@/components/brand/Logo";
import { BillingBanner } from "@/billing/BillingBanner";
import { TrialChip } from "@/billing/TrialChip";
import { formatTenantName } from "@/lib/formatTenantName";
import { FirstUseTour } from "@/onboarding/FirstUseTour";
import { flushFunnelEvents } from "@/telemetry/funnel";
import { ShellRouteFallback } from "@/components/ui/route-fallback";

type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  group: "operation" | "business";
  permission?: string;
  feature?: "margin_reports";
};

const adminNavItems: NavItem[] = [
  { to: "/dashboard", label: copy.app.dashboard, icon: <LayoutDashboard className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/catalog", label: copy.catalog.title, icon: <LayoutGrid className="h-4.5 w-4.5" />, group: "business" },
  { to: "/inventory", label: copy.inventoryView.title, icon: <Package className="h-4.5 w-4.5" />, group: "business" },
  { to: "/reports", label: copy.reportsView.title, icon: <BarChart3 className="h-4.5 w-4.5" />, group: "business", permission: "reports.view_all" },
  { to: "/expenses", label: copy.expenses.title, icon: <WalletCards className="h-4.5 w-4.5" />, group: "business", permission: "expenses.manage", feature: "margin_reports" },
  { to: "/settings", label: copy.app.settings, icon: <Settings className="h-4.5 w-4.5" />, group: "business" },
  { to: "/settings/billing", label: copy.billingView.title, icon: <CreditCard className="h-4.5 w-4.5" />, group: "business", permission: "billing.view" },
];

const cashierNavItems: NavItem[] = [
  { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-4.5 w-4.5" />, group: "operation" },
];

function isAdminRole(role: string): boolean {
  return role === "owner" || role === "manager";
}

function roleLabel(role: string): string {
  if (role === "owner") return copy.settings.roleOwner;
  if (role === "manager") return copy.settings.roleManager;
  if (role === "cashier") return copy.settings.roleCashier;
  return role;
}

const SIDEBAR_COLLAPSED_KEY = "kova-sidebar-collapsed";

function readStoredSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AppShell() {
  const { state, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore — collapse state is a pure UI preference, safe to lose.
      }
      return next;
    });
  };

  const tenantNameRaw = state.status === "authenticated" ? state.tenantName : "";
  const tenantName = formatTenantName(tenantNameRaw);
  const userEmail = state.status === "authenticated" ? state.user.email : "";
  const userRole = state.status === "authenticated" ? state.user.role : "";
  const canViewReports = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const canViewBilling = usePermission(BILLING_VIEW_PERMISSION);
  const canManageExpenses = usePermission(EXPENSES_MANAGE_PERMISSION);
  const marginReportsEnabled = useFeature("margin_reports");

  const navItems = isAdminRole(userRole) ? adminNavItems : cashierNavItems;

  const bottomNavItems: NavItem[] = isAdminRole(userRole)
    ? [
        { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-5 w-5" />, group: "operation" },
        { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-5 w-5" />, group: "operation" },
        { to: "/dashboard", label: copy.app.dashboard, icon: <LayoutDashboard className="h-5 w-5" />, group: "operation" },
      ]
    : [
        { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-5 w-5" />, group: "operation" },
        { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-5 w-5" />, group: "operation" },
        { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-5 w-5" />, group: "operation" },
      ];

  const filteredNavItems = navItems.filter((item) => {
    if (item.permission === "reports.view_all") return canViewReports;
    if (item.permission === "billing.view") return canViewBilling;
    if (item.permission === "expenses.manage" && !canManageExpenses) return false;
    if (item.feature === "margin_reports" && !marginReportsEnabled) return false;
    return true;
  });
  const operationNavItems = filteredNavItems.filter((item) => item.group === "operation");
  const businessNavItems = filteredNavItems.filter((item) => item.group === "business");

  const closeSidebar = () => setSidebarOpen(false);
  // The drawer slides for 280ms; without this the backdrop used to blink out of
  // existence on the first frame, which was the shell's most visible motion bug.
  const backdrop = usePresence(sidebarOpen);

  useEffect(() => {
    if (state.status === "authenticated") {
      void flushFunnelEvents();
    }
  }, [state.status]);

  const SidebarContent = (
    <>
      {/* Brand */}
      <div className={cn(
        "flex items-center border-b border-sidebar-border",
        sidebarCollapsed ? "justify-center px-0 py-5" : "gap-3 px-5 py-5",
      )}>
        <LogoMark size={32} circuitColor="var(--kova-on-ink)" />
        {!sidebarCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-sidebar-muted tracking-[0.14em] uppercase">kova</p>
            <p className="font-semibold text-sm truncate">{tenantName || copy.app.homeTitle}</p>
          </div>
        )}
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={closeSidebar}
          aria-label={copy.app.closeMenu}
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        {/* Collapse toggle — desktop only */}
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          aria-label={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
          className={cn(
            "hidden lg:flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors shrink-0",
            sidebarCollapsed ? "mt-0" : "ml-auto",
          )}
        >
          {sidebarCollapsed
            ? <ChevronsRight className="h-4 w-4" />
            : <ChevronsLeft className="h-4 w-4" />
          }
        </button>
      </div>

      {/* Nav */}
      <nav
        className={cn("flex-1 overflow-y-auto py-4", sidebarCollapsed ? "px-2" : "px-3")}
        aria-label={copy.auth.accountNavigation}
      >
        {[
          { id: "operation", label: "Operación", items: operationNavItems },
          { id: "business", label: "Negocio", items: businessNavItems },
        ].map((section) => section.items.length > 0 ? (
          <div key={section.id} className={cn("space-y-1", section.id === "business" && "mt-5")}>
            {!sidebarCollapsed && (
              <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-muted/70">
                {section.label}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={closeSidebar}
                title={sidebarCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center rounded-kova-md text-sm font-medium transition-[background-color,color,box-shadow] duration-hover ease-standard",
                    sidebarCollapsed ? "justify-center p-2.5" : "gap-3 py-2.5 pl-2.5 pr-3",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={isActive ? "text-kova-blue-light" : undefined}>{item.icon}</span>
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1">{item.label}</span>
                        <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                      </>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ) : null)}
      </nav>

      {/* Footer */}
      <div className={cn("border-t border-sidebar-border space-y-3", sidebarCollapsed ? "p-2" : "p-4")}>
        {!sidebarCollapsed && <OfflineIndicator />}
        <div
          data-capture-account
          className={cn("flex items-center", sidebarCollapsed ? "justify-center" : "gap-3")}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold uppercase text-white shrink-0"
            style={{ background: userEmail ? avatarColorFor(userEmail) : undefined }}
            title={sidebarCollapsed ? userEmail : undefined}
          >
            {userEmail.charAt(0)}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p data-capture-email className="text-xs text-sidebar-muted truncate">{userEmail}</p>
              <p className="text-[10px] text-sidebar-muted">{roleLabel(userRole)}</p>
            </div>
          )}
        </div>
        <button
          onClick={() => void logout()}
          title={sidebarCollapsed ? copy.register.logout : undefined}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/30 px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            sidebarCollapsed && "px-2",
          )}
          type="button"
        >
          <LogOut className="h-4 w-4" />
          {!sidebarCollapsed && copy.register.logout}
        </button>
      </div>
    </>
  );

  return (
    // No `min-h-screen` next to `h-[100dvh]`: min-height always beats height,
    // so it made the dvh unit dead letter and forced the shell to 100vh. Where
    // the two differ (any browser with a retractable toolbar) that surplus
    // becomes document scroll and the shell slides off screen.
    <div className="flex h-[100dvh] overflow-hidden bg-kova-mist">
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-kova-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-kova-on-ink focus:shadow-kova-card"
      >
        {copy.app.skipToContent}
      </a>
      {/* Mobile backdrop overlay */}
      {backdrop.mounted && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden",
            backdrop.exiting ? "animate-fade-out pointer-events-none" : "animate-fade-in",
          )}
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed on mobile, static on desktop */}
      <aside
        className={cn(
          // Mobile off-canvas is transform-only: cheap, and ease-entrance rather
          // than ease-in-out because an ease-in start delays the moment the user
          // is watching for.
          // `min-h-screen` dropped here for the same reason as on the shell
          // root: paired with h-[100dvh] it won, and on a phone with a visible
          // toolbar it pushed the sidebar footer (Cerrar sesión) below the fold.
          "fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[260px] flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-transform duration-modal ease-entrance",
          // Desktop collapse keeps animating `width` — see docs/claude/motion-system.md
          // for why a transform is NOT an option here: moving the content
          // column's left edge would mean putting a transform on the main
          // content div, which is an ancestor of .print-receipt-root and
          // .print-corte-root, turning it into their containing block and
          // breaking thermal printing. Now at least it animates width alone.
          "lg:relative lg:translate-x-0 lg:shrink-0 lg:transition-[width] lg:duration-modal lg:ease-standard",
          sidebarCollapsed ? "lg:w-[60px]" : "lg:w-[260px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {SidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Mobile top bar */}
        <header className="flex items-center gap-2 border-b bg-background px-3 py-3 lg:hidden shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label={copy.app.openMenu}
            aria-expanded={sidebarOpen}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <LogoMark size={24} circuitColor="var(--kova-ink)" />
          {/* Tenant name yields space first so the status/trial chips always fit. */}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tenantName || copy.app.homeTitle}</span>
          {/* Persistent online/offline + queue visibility on mobile, where the
              sidebar footer (its only home before) is hidden during POS. */}
          <OfflineIndicator compact />
          <TrialChip compact />
        </header>

        {/* Desktop command bar; mobile keeps the compact header and bottom navigation. */}
        <header className="hidden h-[72px] shrink-0 items-center justify-end gap-3 border-b border-kova-border bg-white px-6 lg:flex">
          <OfflineIndicator compact showOnlineLabel />
          <TrialChip />
          <Link
            to="/register"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-kova-md bg-kova-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-kova-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            Nueva venta
          </Link>
        </header>

        {/* Skip-link target. Kept as a <div>: each routed view renders its own
            <main> landmark, so a second one here would nest landmarks. */}
        {/* `relative` is load-bearing, not cosmetic. Every ancestor up to <html>
            is position:static, so an absolutely positioned descendant — the
            .sr-only chart summaries in ChartCard, for one — would resolve its
            containing block to the initial containing block, escape this
            scroller's clipping entirely, and land at its static position in
            DOCUMENT coordinates. On a long view like Análisis that put a 1px
            paragraph ~2200px down the page, gave the document a scroll range it
            should never have, and let a wheel gesture slide the whole shell
            (sidebar included) off screen. Making this the containing block
            keeps out-of-flow descendants inside the only scroller that should
            ever move. See the @media print reset in styles.css. */}
        <div
          id="contenido-principal"
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto overscroll-contain pb-16 lg:pb-0 focus:outline-none"
        >
          <BillingBanner />
          <Suspense fallback={<ShellRouteFallback />}>
            <Outlet />
          </Suspense>
        </div>
        <FirstUseTour />

        {/* Bottom navigation — mobile only */}
        <nav
          className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-kova-border bg-white/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label={copy.auth.accountNavigation}
        >
          {bottomNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  isActive
                    ? "text-kova-blue"
                    : "text-kova-muted hover:text-kova-ink",
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label={copy.app.openMenu}
            className="flex h-14 flex-col items-center justify-center gap-1 text-xs font-medium text-kova-muted hover:text-kova-ink transition-colors"
          >
            <Menu className="h-5 w-5" />
            <span>{copy.app.more ?? "Más"}</span>
          </button>
        </nav>
      </div>
    </div>
  );

}

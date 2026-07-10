import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { copy } from "@/i18n/messages";
import { useAuth } from "@/auth/useAuth";
import { usePermission, REPORTS_VIEW_ALL_PERMISSION, BILLING_VIEW_PERMISSION } from "@/auth/permissions";
import {
  ShoppingCart,
  LayoutGrid,
  ClipboardList,
  Package,
  Clock,
  BarChart3,
  CreditCard,
  Settings,
  LogOut,
  LayoutDashboard,
  ChevronRight,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OfflineIndicator } from "@/offline/OfflineIndicator";
import { LogoMark } from "@/components/brand/Logo";
import { BillingBanner } from "@/billing/BillingBanner";
import { TrialChip } from "@/billing/TrialChip";
import { formatTenantName } from "@/lib/formatTenantName";
import { FirstUseTour } from "@/onboarding/FirstUseTour";
import { flushFunnelEvents } from "@/telemetry/funnel";

type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
};

const adminNavItems: NavItem[] = [
  { to: "/dashboard", label: copy.app.dashboard, icon: <LayoutDashboard className="h-4.5 w-4.5" /> },
  { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-4.5 w-4.5" /> },
  { to: "/catalog", label: copy.catalog.title, icon: <LayoutGrid className="h-4.5 w-4.5" /> },
  { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-4.5 w-4.5" /> },
  { to: "/inventory", label: copy.inventoryView.title, icon: <Package className="h-4.5 w-4.5" /> },
  { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-4.5 w-4.5" /> },
  { to: "/reports", label: copy.reportsView.title, icon: <BarChart3 className="h-4.5 w-4.5" />, permission: "reports.view_all" },
  { to: "/settings", label: copy.app.settings, icon: <Settings className="h-4.5 w-4.5" /> },
  { to: "/settings/billing", label: copy.billingView.title, icon: <CreditCard className="h-4.5 w-4.5" />, permission: "billing.view" },
];

const cashierNavItems: NavItem[] = [
  { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-4.5 w-4.5" /> },
  { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-4.5 w-4.5" /> },
  { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-4.5 w-4.5" /> },
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

export default function AppShell() {
  const { state, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const tenantNameRaw = state.status === "authenticated" ? state.tenantName : "";
  const tenantName = formatTenantName(tenantNameRaw);
  const userEmail = state.status === "authenticated" ? state.user.email : "";
  const userRole = state.status === "authenticated" ? state.user.role : "";
  const canViewReports = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const canViewBilling = usePermission(BILLING_VIEW_PERMISSION);

  const navItems = isAdminRole(userRole) ? adminNavItems : cashierNavItems;

  const bottomNavItems: NavItem[] = isAdminRole(userRole)
    ? [
        { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-5 w-5" /> },
        { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-5 w-5" /> },
        { to: "/dashboard", label: copy.app.dashboard, icon: <LayoutDashboard className="h-5 w-5" /> },
      ]
    : [
        { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-5 w-5" /> },
        { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-5 w-5" /> },
        { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-5 w-5" /> },
      ];

  const filteredNavItems = navItems.filter((item) => {
    if (item.permission === "reports.view_all") return canViewReports;
    if (item.permission === "billing.view") return canViewBilling;
    return true;
  });

  const closeSidebar = () => setSidebarOpen(false);

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
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
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
        className={cn("flex-1 overflow-y-auto py-4 space-y-1", sidebarCollapsed ? "px-2" : "px-3")}
        aria-label={copy.auth.accountNavigation}
      >
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={closeSidebar}
            title={sidebarCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                "group flex items-center rounded-lg text-sm font-medium transition-all duration-150",
                sidebarCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )
            }
          >
            {item.icon}
            {!sidebarCollapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className={cn("border-t border-sidebar-border space-y-3", sidebarCollapsed ? "p-2" : "p-4")}>
        {!sidebarCollapsed && <OfflineIndicator />}
        <div className={cn("flex items-center", sidebarCollapsed ? "justify-center" : "gap-3")}>
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-bold uppercase shrink-0"
            title={sidebarCollapsed ? userEmail : undefined}
          >
            {userEmail.charAt(0)}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs text-sidebar-muted truncate">{userEmail}</p>
              <p className="text-[10px] text-sidebar-muted/60">{roleLabel(userRole)}</p>
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
    <div className="flex h-[100dvh] min-h-screen overflow-hidden">
      {/* Mobile backdrop overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed on mobile, static on desktop */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-[100dvh] min-h-screen w-[260px] flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300 ease-in-out",
          "lg:relative lg:translate-x-0 lg:shrink-0",
          sidebarCollapsed ? "lg:w-[60px]" : "lg:w-[260px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {SidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Mobile top bar */}
        <header className="flex items-center gap-3 border-b bg-background px-4 py-3 lg:hidden shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label={copy.app.openMenu}
            aria-expanded={sidebarOpen}
            className="flex h-11 w-11 items-center justify-center rounded-lg border hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <LogoMark size={24} circuitColor="var(--kova-ink)" />
          <span className="font-semibold text-sm truncate">{tenantName || copy.app.homeTitle}</span>
          <div className="ml-auto">
            <TrialChip />
          </div>
        </header>

        {/* Desktop trial chip — top-right of content area */}
        <div className="hidden lg:flex items-center justify-end px-8 pt-4">
          <TrialChip />
        </div>

        <div className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          <BillingBanner />
          <Outlet />
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

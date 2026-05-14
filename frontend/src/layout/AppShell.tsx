import { useState } from "react";
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
  LogOut,
  LayoutDashboard,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OfflineIndicator } from "@/offline/OfflineIndicator";

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

export default function AppShell() {
  const { state, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const userEmail = state.status === "authenticated" ? state.user.email : "";
  const userRole = state.status === "authenticated" ? state.user.role : "";
  const canViewReports = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const canViewBilling = usePermission(BILLING_VIEW_PERMISSION);

  const navItems = isAdminRole(userRole) ? adminNavItems : cashierNavItems;

  const filteredNavItems = navItems.filter((item) => {
    if (item.permission === "reports.view_all") return canViewReports;
    if (item.permission === "billing.view") return canViewBilling;
    return true;
  });

  const closeSidebar = () => setSidebarOpen(false);

  const SidebarContent = (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400 text-sidebar font-extrabold text-sm shadow-md shrink-0">
          POS
        </div>
        <div className="min-w-0">
          <p className="text-xs text-sidebar-muted tracking-wide uppercase">Operations</p>
          <p className="font-semibold text-sm truncate">{tenantName || copy.app.homeTitle}</p>
        </div>
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={closeSidebar}
          aria-label={copy.app.closeMenu}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label={copy.auth.accountNavigation}>
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={closeSidebar}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )
            }
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            <ChevronRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4 space-y-3">
        <OfflineIndicator />
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-bold uppercase shrink-0">
            {userEmail.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-sidebar-muted truncate">{userEmail}</p>
            <p className="text-[10px] text-sidebar-muted/60 capitalize">{userRole}</p>
          </div>
        </div>
        <button
          onClick={() => void logout()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/30 px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          type="button"
        >
          <LogOut className="h-4 w-4" />
          {copy.register.logout}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">
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
          "fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-transform duration-300 ease-in-out",
          "lg:relative lg:translate-x-0 lg:shrink-0",
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
            className="flex h-9 w-9 items-center justify-center rounded-lg border hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-7 w-7 items-center justify-center rounded bg-amber-400 font-extrabold text-xs text-sidebar">
            POS
          </div>
          <span className="font-semibold text-sm truncate">{tenantName || copy.app.homeTitle}</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

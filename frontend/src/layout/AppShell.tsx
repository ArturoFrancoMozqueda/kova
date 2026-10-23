import { BranchSelector } from "@/branches/BranchSelector";
import { AssistantCompanion } from "@/assistant/AssistantCompanion";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { copy } from "@/i18n/messages";
import { useAuth } from "@/auth/useAuth";
import { useFeature } from "@/auth/useFeature";
import {
  BILLING_VIEW_PERMISSION,
  CATALOG_CREATE_PERMISSION,
  CUSTOMER_ORDER_VIEW_PERMISSION,
  CUSTOMER_ORDER_CREATE_PERMISSION,
  CUSTOMERS_VIEW_PERMISSION,
  INVENTORY_ADJUST_PERMISSION,
  EXPENSES_MANAGE_PERMISSION,
  REPORTS_VIEW_ALL_PERMISSION,
  usePermission,
} from "@/auth/permissions";
import {
  ShoppingCart,
  LayoutGrid,
  ClipboardList,
  ClipboardCheck,
  HeartHandshake,
  ListChecks,
  Receipt,
  Package,
  Clock,
  BarChart3,
  CreditCard,
  WalletCards,
  Users,
  Truck,
  Settings,
  LogOut,
  LayoutDashboard,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Sparkles,
  Workflow,
  Handshake,
  Store,
  FileText,
  MessagesSquare,
  CalendarDays,
  Gift,
  LifeBuoy,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/usePresence";
import { avatarColorFor } from "@/lib/avatarColor";
import { OfflineIndicator } from "@/offline/OfflineIndicator";
import { TenantBrandMark } from "@/components/brand/TenantBrandMark";
import { BillingBanner } from "@/billing/BillingBanner";
import { EmailVerificationBanner } from "@/auth/EmailVerificationBanner";
import { TrialChip } from "@/billing/TrialChip";
import { formatTenantName } from "@/lib/formatTenantName";
import { FirstUseTour } from "@/onboarding/FirstUseTour";
import { flushFunnelEvents } from "@/telemetry/funnel";
import { ShellRouteFallback } from "@/components/ui/route-fallback";
import { SupportDialog } from "@/support/SupportDialog";
import { useToast } from "@/components/ui/toast";
import { trapTabKey } from "@/lib/focusTrap";
import { discoverSections, sectionDescription } from "./navigationDiscovery";
import { BusinessNextActions } from "./BusinessNextActions";
import { buildWorkspaceNavigation, workspaceGroupForPath } from "./workspaceNavigation";

type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  group: "operation" | "business";
  permission?: string;
  feature?: "margin_reports" | "customer_orders";
};

const adminNavItems: NavItem[] = [
  { to: "/customers", label: copy.nav.customers, icon: <Users className="h-4.5 w-4.5" />, group: "business", permission: CUSTOMERS_VIEW_PERMISSION },

  { to: "/dashboard", label: copy.app.dashboard, icon: <LayoutDashboard className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/pedidos", label: copy.app.customerOrders, icon: <ClipboardCheck className="h-4.5 w-4.5" />, group: "operation", permission: CUSTOMER_ORDER_VIEW_PERMISSION, feature: "customer_orders" },
  { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/catalog", label: copy.catalog.title, icon: <LayoutGrid className="h-4.5 w-4.5" />, group: "business" },
  { to: "/purchasing", label: copy.nav.purchasing, icon: <Truck className="h-4.5 w-4.5" />, group: "business", permission: INVENTORY_ADJUST_PERMISSION },
  { to: "/settings/integrations", label: copy.nav.integrations, icon: <Receipt className="h-4.5 w-4.5" />, group: "business" },
  { to: "/inventory", label: copy.inventoryView.title, icon: <Package className="h-4.5 w-4.5" />, group: "business" },
  { to: "/reports", label: copy.reportsView.title, icon: <BarChart3 className="h-4.5 w-4.5" />, group: "business", permission: "reports.view_all" },
  { to: "/expenses", label: copy.expenses.title, icon: <WalletCards className="h-4.5 w-4.5" />, group: "business", permission: "expenses.manage", feature: "margin_reports" },
  { to: "/assistant", label: copy.nav.assistant, icon: <Sparkles className="h-4.5 w-4.5" />, group: "business", permission: "reports.view_all" },
  { to: "/operations-queue", label: copy.nav.operationsQueue, icon: <ListChecks className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/service-cases", label: copy.nav.serviceCases, icon: <LifeBuoy className="h-4.5 w-4.5" />, group: "business" },
  { to: "/appointments", label: copy.nav.appointments, icon: <CalendarDays className="h-4.5 w-4.5" />, group: "business" },
  { to: "/loyalty", label: copy.nav.loyalty, icon: <Gift className="h-4.5 w-4.5" />, group: "business" },
  { to: "/inbox", label: copy.nav.inbox, icon: <MessagesSquare className="h-4.5 w-4.5" />, group: "business" },
  { to: "/commercial-requests", label: copy.nav.commercialRequests, icon: <Handshake className="h-4.5 w-4.5" />, group: "business" },
  { to: "/followups", label: copy.nav.followups, icon: <HeartHandshake className="h-4.5 w-4.5" />, group: "business" },
  { to: "/crm", label: copy.nav.crm, icon: <Handshake className="h-4.5 w-4.5" />, group: "business" },
  { to: "/quotes", label: copy.nav.quotes, icon: <FileText className="h-4.5 w-4.5" />, group: "business" },
  { to: "/automations", label: copy.nav.automations, icon: <Workflow className="h-4.5 w-4.5" />, group: "business" },
  { to: "/settings/public-catalog", label: copy.nav.publicCatalog, icon: <Store className="h-4.5 w-4.5" />, group: "business" },
  { to: "/settings/channels", label: copy.nav.channels, icon: <MessagesSquare className="h-4.5 w-4.5" />, group: "business" },
  { to: "/reconciliation", label: copy.nav.reconciliation, icon: <WalletCards className="h-4.5 w-4.5" />, group: "business" },
  { to: "/replenishment", label: copy.nav.replenishment, icon: <Package className="h-4.5 w-4.5" />, group: "business", permission: INVENTORY_ADJUST_PERMISSION },
  { to: "/settings", label: copy.app.settings, icon: <Settings className="h-4.5 w-4.5" />, group: "business" },
  { to: "/settings/billing", label: copy.billingView.title, icon: <CreditCard className="h-4.5 w-4.5" />, group: "business", permission: "billing.view" },
];

const cashierNavItems: NavItem[] = [
  { to: "/customers", label: copy.nav.customers, icon: <Users className="h-4.5 w-4.5" />, group: "operation", permission: CUSTOMERS_VIEW_PERMISSION },

  { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/pedidos", label: copy.app.customerOrders, icon: <ClipboardCheck className="h-4.5 w-4.5" />, group: "operation", permission: CUSTOMER_ORDER_VIEW_PERMISSION, feature: "customer_orders" },
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
  const location = useLocation();
  const { state, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia?.("(min-width: 1280px)").matches ?? false);
  const sidebarRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const [navigationQuery, setNavigationQuery] = useState("");
  const navigationSearchRef = useRef<HTMLInputElement>(null);
  const focusSearchOnExpand = useRef(false);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      toast(copy.auth.offlineLogoutStorageError, "error");
    }
  };

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

  useEffect(() => {
    setNavigationQuery("");
  }, [location.pathname]);

  const tenantNameRaw = state.status === "authenticated" ? state.tenantName : "";
  const tenantName = formatTenantName(tenantNameRaw);
  const tenantLogoUrl = state.status === "authenticated" ? state.tenantLogoUrl : null;
  const userEmail = state.status === "authenticated" ? state.user.email : "";
  const userRole = state.status === "authenticated" ? state.user.role : "";
  const isOfflineSession = state.status === "authenticated" && state.sessionMode === "offline";
  const canViewReports = usePermission(REPORTS_VIEW_ALL_PERMISSION);
  const canViewBilling = usePermission(BILLING_VIEW_PERMISSION);
  const canManageExpenses = usePermission(EXPENSES_MANAGE_PERMISSION);
  const canViewCustomers = usePermission(CUSTOMERS_VIEW_PERMISSION);
  const canAdjustInventory = usePermission(INVENTORY_ADJUST_PERMISSION);
  const canViewCustomerOrders = usePermission(CUSTOMER_ORDER_VIEW_PERMISSION);
  const canCreateCustomerOrders = usePermission(CUSTOMER_ORDER_CREATE_PERMISSION);
  const canCreateProducts = usePermission(CATALOG_CREATE_PERMISSION);
  const marginReportsEnabled = useFeature("margin_reports");
  const customerOrdersEnabled = useFeature("customer_orders");
  const assistantIdentity = state.status === "authenticated" && state.sessionMode === "online" && isAdminRole(state.user.role)
    ? `${state.tenantId}:${state.user.id}:${state.user.role}` : null;
  const loadingViewName = (() => {
    const path = location.pathname;
    if (path.startsWith("/customers")) return "Clientes";
    if (path.startsWith("/operations-queue")) return "Pendientes del negocio";
    if (path.startsWith("/service-cases")) return "Atención postventa";
    if (path.startsWith("/appointments")) return "Agenda del negocio";
    if (path.startsWith("/loyalty")) return "Lealtad de clientes";
    if (path.startsWith("/inbox")) return "Bandeja de atención";
    if (path.startsWith("/commercial-requests")) return "Solicitudes del catálogo";
    if (path.startsWith("/followups")) return "Postventa y seguimiento";
    if (path.startsWith("/crm")) return "Seguimiento comercial";
    if (path.startsWith("/quotes")) return "Cotizaciones";
    if (path.startsWith("/automations")) return "Automatizaciones";
    if (path.startsWith("/reconciliation")) return "Conciliación";
    if (path.startsWith("/replenishment")) return "Reposición";
    if (path.startsWith("/settings/public-catalog")) return "Catálogo público";
    if (path.startsWith("/settings/channels")) return "Canales";
    if (path.startsWith("/purchasing")) return "Compras y proveedores";
    if (path.startsWith("/settings/integrations")) return "Facturación e integraciones";
    if (path.startsWith("/register") || path === "/caja") return copy.register.title;
    if (path.startsWith("/shifts") || path === "/turnos") return copy.shiftView.title;
    if (path.startsWith("/catalog") || path === "/catalogo") return copy.catalog.title;
    if (path.startsWith("/inventory") || path === "/inventario") return copy.inventoryView.title;
    if (path.startsWith("/reports") || path === "/reportes") return copy.reportsView.title;
    if (path.startsWith("/orders") || path === "/ventas" || path === "/ordenes") return copy.orderList.title;
    if (path.startsWith("/expenses") || path === "/gastos") return copy.expenses.title;
    if (path.startsWith("/sync-queue")) return copy.syncQueue.title;
    if (path.startsWith("/settings")) return copy.settings.title;
    if (path.startsWith("/assistant")) return "Asistente";
    return copy.app.dashboard;
  })();

  useEffect(() => {
    const controller = new AbortController();
    setAssistantEnabled(false);
    if (!assistantIdentity) return;
    void fetch("/api/v1/assistant/capabilities", { signal: controller.signal, cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<{ enabled: boolean }> : { enabled: false })
      .then(value => { if (!controller.signal.aborted) setAssistantEnabled(value.enabled); })
      .catch(() => { /* Unavailable assistant never blocks navigation or POS. */ });
    return () => controller.abort();
  }, [assistantIdentity]);

  const navItems = isOfflineSession
    ? adminNavItems.filter((item) => item.to === "/register")
    : isAdminRole(userRole)
      ? adminNavItems
      : cashierNavItems;

  const bottomNavItems: NavItem[] = isOfflineSession
    ? [{ to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-5 w-5" />, group: "operation" }]
    : isAdminRole(userRole)
    ? [
        { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-5 w-5" />, group: "operation" },
        customerOrdersEnabled
          ? { to: "/pedidos", label: copy.app.customerOrders, icon: <ClipboardCheck className="h-5 w-5" />, group: "operation" }
          : { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-5 w-5" />, group: "operation" },
        { to: "/dashboard", label: copy.app.dashboard, icon: <LayoutDashboard className="h-5 w-5" />, group: "operation" },
      ]
    : [
        { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-5 w-5" />, group: "operation" },
        customerOrdersEnabled
          ? { to: "/pedidos", label: copy.app.customerOrders, icon: <ClipboardCheck className="h-5 w-5" />, group: "operation" }
          : { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-5 w-5" />, group: "operation" },
        { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-5 w-5" />, group: "operation" },
      ];

  const filteredNavItems = navItems.filter((item) => {
    if (item.to === "/assistant" && !assistantEnabled) return false;
    if (item.permission === CUSTOMERS_VIEW_PERMISSION && !canViewCustomers) return false;
    if (item.permission === INVENTORY_ADJUST_PERMISSION && !canAdjustInventory) return false;
    if (item.permission === "reports.view_all") return canViewReports;
    if (item.permission === "billing.view") return canViewBilling;
    if (item.permission === "expenses.manage" && !canManageExpenses) return false;
    if (item.permission === CUSTOMER_ORDER_VIEW_PERMISSION && !canViewCustomerOrders) return false;
    if (item.feature === "margin_reports" && !marginReportsEnabled) return false;
    if (item.feature === "customer_orders" && !customerOrdersEnabled) return false;
    return true;
  });
  const operationNavItems = ["/register", "/dashboard", "/operations-queue", "/customers", "/orders", "/shifts", "/pedidos"]
    .flatMap(path => filteredNavItems.filter(item => item.to === path && item.group === "operation"));
  const businessNavItems = filteredNavItems.filter((item) => item.group === "business");
  const searchingSections = !(isDesktop && sidebarCollapsed) && navigationQuery.trim().length > 0;
  const searchDestinations = [...operationNavItems, ...businessNavItems];
  if (isAdminRole(userRole) && !isOfflineSession) {
    const hasDestination = (path: string) => filteredNavItems.some(item => item.to === path);
    if (hasDestination("/pedidos") && canCreateCustomerOrders) searchDestinations.push({
      to: "/pedidos/nuevo", label: copy.nav.createOrder, icon: <ClipboardCheck className="h-4.5 w-4.5" />, group: "business",
    });
    if (hasDestination("/catalog") && canCreateProducts) searchDestinations.push({
      to: "/catalog?new=product", label: copy.nav.createProduct, icon: <Package className="h-4.5 w-4.5" />, group: "business",
    });
    if (hasDestination("/settings")) {
      for (const [to, label] of [
        ["/settings/business-profile", "Perfil del negocio"],
        ["/settings/receipt", "Personalizar recibo"],
        ["/settings/branches", "Sucursales"],
        ...(userRole === "owner" ? [["/settings/employees", "Empleados y accesos"]] : []),
      ]) searchDestinations.push({ to, label, icon: <Settings className="h-4.5 w-4.5" />, group: "business" });
    }
  }
  const sectionResults = searchingSections ? discoverSections(searchDestinations, navigationQuery) : [];
  const workspaceNavigation = buildWorkspaceNavigation(filteredNavItems);
  const activeWorkspace = workspaceGroupForPath(location.pathname);
  const relatedWorkspace = workspaceNavigation.find(group => group.id === activeWorkspace);
  const workspaceLabels = {
    sales: copy.orderList.title,
    customers: copy.nav.customers,
    operation: copy.nav.workspaceOperation,
    analysis: copy.reportsView.title,
    settings: copy.app.settings,
  };
  const useWorkspaces = isAdminRole(userRole) && !isOfflineSession;
  const primaryNavItems = useWorkspaces
    ? ["/dashboard", "/register"].flatMap(path => filteredNavItems.filter(item => item.to === path))
    : operationNavItems;

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const drawerOpen = sidebarOpen && !isDesktop;

  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 1280px)");
    if (!media) return;
    const update = () => {
      setIsDesktop(media.matches);
      if (media.matches) setSidebarOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    drawerTriggerRef.current = trigger;
    const sidebar = sidebarRef.current;
    sidebar?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSidebar();
      } else if (sidebar) {
        trapTabKey(event, sidebar);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Another dialog (such as support) may already have taken focus.
      if (trigger?.isConnected && (sidebar?.contains(document.activeElement) || document.activeElement === document.body)) {
        trigger.focus();
      }
    };
  }, [drawerOpen, closeSidebar]);
  // The drawer slides for 280ms; without this the backdrop used to blink out of
  // existence on the first frame, which was the shell's most visible motion bug.
  const backdrop = usePresence(sidebarOpen);

  useEffect(() => {
    if (state.status === "authenticated") {
      void flushFunnelEvents();
    }
  }, [state.status]);

  // The saved collapse preference applies only to the desktop rail.
  const sidebarCompact = isDesktop && sidebarCollapsed;

  useEffect(() => {
    if (sidebarCompact) setNavigationQuery("");
    if (!sidebarCompact && focusSearchOnExpand.current && (isDesktop || drawerOpen)) {
      focusSearchOnExpand.current = false;
      navigationSearchRef.current?.focus();
    }
  }, [sidebarCompact, drawerOpen, isDesktop]);

  const openNavigationSearch = (trigger: HTMLElement) => {
    trigger.focus();
    if (isDesktop && !sidebarCompact) {
      navigationSearchRef.current?.focus();
      return;
    }
    focusSearchOnExpand.current = true;
    if (isDesktop) toggleSidebarCollapsed();
    else setSidebarOpen(true);
  };

  const renderNavItem = (item: NavItem, nested = false, describe = false, scopeActive = false) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.to === "/settings"}
      onClick={() => { setNavigationQuery(""); closeSidebar(); }}
      title={sidebarCompact ? item.label : undefined}
      aria-label={sidebarCompact || describe ? item.label : undefined}
      aria-describedby={describe ? `section-purpose-${item.to.replaceAll("/", "-")}` : undefined}
      className={({ isActive }) => cn(
        "group relative flex min-h-10 items-center gap-3 overflow-hidden rounded-kova-md py-2.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-hover ease-standard before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-kova-blue-light",
        sidebarCompact ? "justify-center px-2.5" : "px-2.5",
        nested && "text-[13px]",
        (isActive || scopeActive) ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm before:scale-y-100"
          : "text-sidebar-foreground/80 before:scale-y-0 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
      )}
    >
      {({ isActive }) => <>
        <span className={cn("relative z-10 shrink-0", (isActive || scopeActive) && "text-kova-blue-light")}>{item.icon}</span>
        <span aria-hidden={sidebarCompact} className={cn(
          "min-w-0 flex-1 whitespace-normal break-words text-left leading-5 transition-[opacity,transform] duration-panel ease-standard",
          sidebarCompact ? "pointer-events-none absolute left-[42px] translate-x-1 opacity-0" : "translate-x-0 opacity-100",
        )}>{item.label}{describe && <span id={`section-purpose-${item.to.replaceAll("/", "-")}`}
          className="mt-0.5 block text-xs font-normal leading-4 text-sidebar-muted">{sectionDescription(item.to)}</span>}</span>
      </>}
    </NavLink>
  );

  const SidebarContent = (
    <>
      {/* Brand */}
      <div className={cn(
        "relative flex items-center border-b border-sidebar-border",
        sidebarCompact ? "justify-center px-0 py-5" : "gap-3 px-5 py-5",
      )}>
        <TenantBrandMark
          logoUrl={tenantLogoUrl}
          size={32}
          surface="sidebar"
          fallbackCircuitColor="var(--kova-on-ink)"
        />
        <div
          aria-hidden={sidebarCompact}
          className={cn(
            "absolute left-16 right-14 min-w-0 transition-[opacity,transform] duration-panel ease-standard",
            sidebarCompact ? "pointer-events-none translate-x-1 opacity-0" : "translate-x-0 opacity-100",
          )}
        >
          <p className="text-[10px] text-sidebar-muted tracking-[0.14em] uppercase">kova</p>
          <p className="font-semibold text-sm truncate">{tenantName || copy.app.homeTitle}</p>
        </div>
        {/* Close button — mobile only */}
        <button
          type="button"
          onClick={closeSidebar}
          aria-label={copy.app.closeMenu}
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors xl:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        {/* Collapse toggle — desktop only */}
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          aria-label={sidebarCompact ? "Expandir menú" : "Contraer menú"}
          className={cn(
            "hidden xl:flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors shrink-0",
            sidebarCompact ? "mt-0" : "ml-auto",
          )}
        >
          {sidebarCompact
            ? <ChevronsRight className="h-4 w-4" />
            : <ChevronsLeft className="h-4 w-4" />
          }
        </button>
      </div>

      {filteredNavItems.length > 1 && <div className={cn("border-b border-sidebar-border", sidebarCompact ? "px-2 py-3" : "px-3 py-3")}>
        {sidebarCompact ? <button type="button" aria-label="Buscar sección" title="Buscar sección"
          onClick={event => openNavigationSearch(event.currentTarget)}
          className="flex min-h-11 w-full items-center justify-center rounded-kova-md text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground">
          <Search aria-hidden="true" className="h-4 w-4" />
        </button> : <div role="search" aria-label="Buscar secciones de Kova" className="relative">
          <label htmlFor="navigation-section-search" className="sr-only">Buscar sección</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-sidebar-muted" />
          <input id="navigation-section-search" ref={navigationSearchRef} type="search" maxLength={120}
            placeholder="¿Qué quieres hacer?" value={navigationQuery} aria-controls="navigation-sections"
            autoComplete="off" spellCheck={false}
            onChange={event => setNavigationQuery(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape" && navigationQuery) { event.preventDefault(); event.stopPropagation(); setNavigationQuery(""); } }}
            className="min-h-11 w-full rounded-kova-md border border-sidebar-border bg-sidebar-accent/30 py-2 pl-9 pr-10 text-sm text-sidebar-foreground placeholder:text-sidebar-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue-light [&::-webkit-search-cancel-button]:appearance-none" />
          {navigationQuery && <button type="button" aria-label="Limpiar búsqueda de secciones"
            onClick={() => { setNavigationQuery(""); navigationSearchRef.current?.focus(); }}
            className="absolute right-0 top-0 flex h-11 w-10 items-center justify-center rounded-kova-md text-sidebar-muted hover:text-sidebar-foreground">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>}
        </div>}
      </div>}

      {/* Nav */}
      <nav
        id="navigation-sections"
        className={cn("flex-1 overflow-y-auto py-4", sidebarCompact ? "px-2" : "px-3")}
        aria-label={copy.auth.accountNavigation}
      >
        {searchingSections ? <div className="space-y-1">
          <p role="status" className="px-2 pb-2 text-xs text-sidebar-muted">{sectionResults.length
            ? `${sectionResults.length} ${sectionResults.length === 1 ? "resultado encontrado" : "resultados encontrados"}`
            : "No encontramos esa acción o sección. Prueba con lo que quieres hacer, como cobrar o compartir productos."}</p>
          {sectionResults.map(item => renderNavItem(item, false, true))}
        </div> : <>
          <div className="space-y-1">
            {primaryNavItems.map(item => renderNavItem(item))}
            {useWorkspaces && workspaceNavigation.map(group => renderNavItem(
              { ...group.destination, label: workspaceLabels[group.id] }, false, false, group.id === activeWorkspace,
            ))}
          </div>
          {useWorkspaces && relatedWorkspace && <div className={cn("mt-4 border-t border-sidebar-border pt-4", sidebarCompact && "pt-2")}>
            <h2 className={cn("px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-sidebar-muted", sidebarCompact && "sr-only")}>
              {copy.nav.relatedSections}: {workspaceLabels[relatedWorkspace.id]}
            </h2>
            <div className="space-y-1">
              {relatedWorkspace.items.filter(item => item.to !== relatedWorkspace.destination.to).map(item => renderNavItem(item, !sidebarCompact))}
            </div>
          </div>}
        </>}

      </nav>

      {/* Footer */}
      <div className={cn("border-t border-sidebar-border space-y-3", sidebarCompact ? "p-2" : "p-4")}>
        {!sidebarCompact && <OfflineIndicator />}
        <button
          type="button"
          onClick={() => {
            closeSidebar();
            setSupportOpen(true);
          }}
          aria-label={copy.app.support}
          title={sidebarCompact ? copy.app.support : undefined}
          className={cn(
            "relative flex h-10 w-full items-center rounded-kova-md text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue-light",
            sidebarCompact ? "justify-center px-2" : "gap-3 px-2.5",
          )}
        >
          <CircleHelp className="h-4 w-4 shrink-0" />
          {!sidebarCompact ? <span>{copy.app.support}</span> : null}
        </button>
        <div
          data-capture-account
          className={cn("relative flex items-center", sidebarCompact ? "justify-center" : "gap-3")}
        >
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold uppercase text-white shrink-0"
            style={{ background: userEmail ? avatarColorFor(userEmail) : undefined }}
            title={sidebarCompact ? userEmail : undefined}
          >
            {userEmail.charAt(0)}
          </div>
          <div
            aria-hidden={sidebarCompact}
            className={cn(
              "absolute left-11 right-0 min-w-0 transition-[opacity,transform] duration-panel ease-standard",
              sidebarCompact ? "pointer-events-none translate-x-1 opacity-0" : "translate-x-0 opacity-100",
            )}
          >
            <p data-capture-email className="text-xs text-sidebar-muted truncate">{userEmail}</p>
            <p className="text-[10px] text-sidebar-muted">{roleLabel(userRole)}</p>
          </div>
        </div>
        <button
          onClick={() => void handleLogout()}
          title={sidebarCompact ? copy.register.logout : undefined}
          className={cn(
            "relative flex min-h-10 w-full items-center justify-start rounded-kova-md border border-sidebar-border bg-sidebar-accent/30 px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            sidebarCompact && "px-2",
          )}
          type="button"
        >
          <LogOut className={cn("h-4 w-4 shrink-0", sidebarCompact && "mx-auto")} />
          <span
            aria-hidden={sidebarCompact}
            className={cn(
              "absolute left-9 whitespace-nowrap transition-[opacity,transform] duration-panel ease-standard",
              sidebarCompact ? "pointer-events-none translate-x-1 opacity-0" : "translate-x-0 opacity-100",
            )}
          >
            {copy.register.logout}
          </span>
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
        {...(drawerOpen ? ({ "aria-hidden": true, inert: "" } as React.HTMLAttributes<HTMLAnchorElement>) : {})}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-kova-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-kova-on-ink focus:shadow-kova-card"
      >
        {copy.app.skipToContent}
      </a>
      {/* Mobile backdrop overlay */}
      {backdrop.mounted && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm xl:hidden",
            backdrop.exiting ? "animate-fade-out pointer-events-none" : "animate-fade-in",
          )}
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed on mobile, static on desktop */}
      <aside
        ref={sidebarRef}
        id="menu-de-navegacion"
        tabIndex={-1}
        role={drawerOpen ? "dialog" : undefined}
        aria-label={drawerOpen ? copy.auth.accountNavigation : undefined}
        aria-modal={drawerOpen ? true : undefined}
        {...(!isDesktop && !sidebarOpen ? ({ "aria-hidden": true, inert: "" } as React.HTMLAttributes<HTMLElement>) : {})}
        className={cn(
          // Mobile off-canvas is transform-only: cheap, and ease-entrance rather
          // than ease-in-out because an ease-in start delays the moment the user
          // is watching for.
          // `min-h-screen` dropped here for the same reason as on the shell
          // root: paired with h-[100dvh] it won, and on a phone with a visible
          // toolbar it pushed the sidebar footer (Cerrar sesión) below the fold.
          "fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[260px] flex-col overflow-hidden bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-transform duration-modal ease-entrance",
          // Desktop collapse keeps animating `width` — see docs/claude/motion-system.md
          // for why a transform is NOT an option here: moving the content
          // column's left edge would mean putting a transform on the main
          // content div, which is an ancestor of .print-receipt-root and
          // .print-corte-root, turning it into their containing block and
          // breaking thermal printing. Now at least it animates width alone.
          "xl:relative xl:translate-x-0 xl:shrink-0 xl:transition-[width] xl:duration-modal xl:ease-standard",
          sidebarCollapsed ? "xl:w-[60px]" : "xl:w-[260px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {SidebarContent}
      </aside>

      {/* Main content */}
      <div
        {...(drawerOpen ? ({ "aria-hidden": true, inert: "" } as React.HTMLAttributes<HTMLDivElement>) : {})}
        className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
      >
        {/* Mobile top bar */}
        <header className="flex items-center gap-2 border-b bg-background px-3 py-3 xl:hidden shrink-0">
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus();
              setSidebarOpen(true);
            }}
            aria-label={copy.app.openMenu}
            aria-expanded={sidebarOpen}
            aria-controls="menu-de-navegacion"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>
          <TenantBrandMark
            logoUrl={tenantLogoUrl}
            size={24}
            surface="header"
            fallbackCircuitColor="var(--kova-ink)"
          />
          {/* Tenant name yields space first so the status/trial chips always fit. */}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tenantName || copy.app.homeTitle}</span>
          {/* Persistent online/offline + queue visibility on mobile, where the
              sidebar footer (its only home before) is hidden during POS. */}
          {!isDesktop && isAdminRole(userRole) && !isOfflineSession ? <button
            type="button" aria-label="Buscar tareas del negocio" aria-controls="navigation-sections"
            onClick={event => openNavigationSearch(event.currentTarget)}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue"
          >
            <Search aria-hidden="true" className="h-4 w-4" /><span className="hidden sm:inline">Buscar</span>
          </button> : null}
          <OfflineIndicator compact />
          <TrialChip compact />
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
          className="relative flex-1 overflow-y-auto overscroll-contain pb-16 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-kova-blue xl:pb-0"
        >
          {isOfflineSession ? (
            <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-xs font-medium text-warning-strong" role="status">
              {copy.auth.offlineAccessBanner}
            </div>
          ) : null}
          <BranchSelector />
          {!isOfflineSession ? <EmailVerificationBanner /> : null}
          {!isOfflineSession ? <BillingBanner /> : null}
          <Suspense
            fallback={(
              <ShellRouteFallback
                label={`Cargando ${loadingViewName}`}
                viewName={loadingViewName}
              />
            )}
          >
            <Outlet />
          </Suspense>
          {/* Continuation follows the task so primary content keeps its mobile viewport. */}
          {isAdminRole(userRole) && !isOfflineSession ? (
            <BusinessNextActions pathname={location.pathname} destinations={filteredNavItems} canCreateCustomerOrders={canCreateCustomerOrders} />
          ) : null}
        </div>
        <FirstUseTour />
        <AssistantCompanion enabled={assistantEnabled} suspended={sidebarOpen || supportOpen} />

        {/* Bottom navigation — mobile only */}
        <nav
          className={cn(
            "fixed inset-x-0 bottom-0 z-30 grid border-t border-kova-border bg-white/95 backdrop-blur xl:hidden",
            isOfflineSession ? "grid-cols-1" : "grid-cols-4",
          )}
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label={copy.auth.accountNavigation}
        >
          {bottomNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "relative flex h-14 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors after:absolute after:top-0 after:h-0.5 after:w-8 after:origin-center after:rounded-full after:bg-kova-blue after:transition-transform after:duration-quick after:ease-entrance",
                  isActive
                    ? "text-kova-blue after:scale-x-100"
                    : "text-kova-muted after:scale-x-0 hover:text-kova-ink",
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={(event) => {
              event.currentTarget.focus();
              setSidebarOpen(true);
            }}
            aria-label={copy.app.openMenu}
            aria-expanded={sidebarOpen}
            aria-controls="menu-de-navegacion"
            className="flex h-14 flex-col items-center justify-center gap-1 text-xs font-medium text-kova-muted hover:text-kova-ink transition-colors"
          >
            <Menu className="h-5 w-5" />
            <span>{copy.app.more ?? "Más"}</span>
          </button>
        </nav>
      </div>
      <SupportDialog open={supportOpen} onClose={() => {
        setSupportOpen(false);
        if (!isDesktop) drawerTriggerRef.current?.focus();
      }} />
    </div>
  );

}

import type React from "react";
import {
  BarChart3, CalendarDays, ClipboardCheck, ClipboardList, Clock, CreditCard, FileText, Gift, Handshake,
  HeartHandshake, LayoutDashboard, LayoutGrid, LifeBuoy, ListChecks, MessagesSquare, Package, Receipt,
  Settings, ShoppingCart, Sparkles, Store, Truck, Users, WalletCards, Workflow,
} from "lucide-react";
import { copy } from "@/i18n/messages";
import type { WorkspaceGroupId } from "./workspaceNavigation";
import {
  APPOINTMENTS_OPERATE_PERMISSION,
  BILLING_VIEW_PERMISSION,
  CUSTOMER_ORDER_VIEW_PERMISSION,
  CUSTOMERS_VIEW_PERMISSION,
  EXPENSES_MANAGE_PERMISSION,
  INVENTORY_ADJUST_PERMISSION,
  REPORTS_VIEW_ALL_PERMISSION,
} from "@/auth/permissions";

export type NavItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  group: "operation" | "business";
  permission?: string;
  feature?: "margin_reports" | "customer_orders";
};

export const adminNavItems: NavItem[] = [
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
  { to: "/appointments", label: copy.nav.appointments, icon: <CalendarDays className="h-4.5 w-4.5" />, group: "business", permission: APPOINTMENTS_OPERATE_PERMISSION },
  { to: "/loyalty", label: copy.nav.loyalty, icon: <Gift className="h-4.5 w-4.5" />, group: "business" },
  { to: "/inbox", label: copy.nav.inbox, icon: <MessagesSquare className="h-4.5 w-4.5" />, group: "business" },
  { to: "/commercial-requests", label: copy.nav.commercialRequests, icon: <Handshake className="h-4.5 w-4.5" />, group: "business" },
  { to: "/followups", label: copy.nav.followups, icon: <HeartHandshake className="h-4.5 w-4.5" />, group: "business" },
  { to: "/crm", label: copy.nav.crm, icon: <Handshake className="h-4.5 w-4.5" />, group: "business" },
  { to: "/quotes", label: copy.nav.quotes, icon: <FileText className="h-4.5 w-4.5" />, group: "business" },
  { to: "/automations", label: copy.nav.automations, icon: <Workflow className="h-4.5 w-4.5" />, group: "business" },
  { to: "/settings/public-catalog", label: copy.nav.publicCatalog, icon: <Store className="h-4.5 w-4.5" />, group: "business" },
  { to: "/reconciliation", label: copy.nav.reconciliation, icon: <WalletCards className="h-4.5 w-4.5" />, group: "business" },
  { to: "/replenishment", label: copy.nav.replenishment, icon: <Package className="h-4.5 w-4.5" />, group: "business", permission: INVENTORY_ADJUST_PERMISSION },
  { to: "/settings", label: copy.app.settings, icon: <Settings className="h-4.5 w-4.5" />, group: "business" },
  { to: "/settings/billing", label: copy.billingView.title, icon: <CreditCard className="h-4.5 w-4.5" />, group: "business", permission: "billing.view" },
];

export const cashierNavItems: NavItem[] = [
  { to: "/customers", label: copy.nav.customers, icon: <Users className="h-4.5 w-4.5" />, group: "operation", permission: CUSTOMERS_VIEW_PERMISSION },

  { to: "/register", label: copy.register.title, icon: <ShoppingCart className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/pedidos", label: copy.app.customerOrders, icon: <ClipboardCheck className="h-4.5 w-4.5" />, group: "operation", permission: CUSTOMER_ORDER_VIEW_PERMISSION, feature: "customer_orders" },
  { to: "/orders", label: copy.orderList.title, icon: <ClipboardList className="h-4.5 w-4.5" />, group: "operation" },
  { to: "/shifts", label: copy.shiftView.title, icon: <Clock className="h-4.5 w-4.5" />, group: "operation" },
  // Operational agenda only; its configuration stays owner/manager inside the view.
  { to: "/appointments", label: copy.nav.appointments, icon: <CalendarDays className="h-4.5 w-4.5" />, group: "operation", permission: APPOINTMENTS_OPERATE_PERMISSION },
];

export function isAdminRole(role: string): boolean {
  return role === "owner" || role === "manager";
}


export const workspaceGroupLabels: Record<WorkspaceGroupId, string> = {
  sales: "Menú y ventas",
  customers: "Clientes y atención",
  operation: "Productos y operación",
  analysis: "Análisis y finanzas",
  settings: copy.app.settings,
};

export type NavigationGates = {
  role: string;
  /** Permission check for `role`; AppShell passes the session's, the role preview `permissionsForRole`. */
  can: (permission: string) => boolean;
  offline: boolean;
  commercialBlocked: boolean;
  assistantEnabled: boolean;
  advancedReports: boolean;
  marginReportsEnabled: boolean;
  customerOrdersEnabled: boolean;
};

/**
 * Sections a person sees in the sidebar. AppShell and the role preview in
 * Empleados use this same function; the backend still enforces every permission.
 */
export function visibleNavItems(gates: NavigationGates): NavItem[] {
  const { can } = gates;
  const items = gates.offline
    ? adminNavItems.filter((item) => item.to === "/register")
    : isAdminRole(gates.role)
      ? adminNavItems
      : cashierNavItems;
  return items.filter((item) => {
    if (gates.commercialBlocked) return item.to === "/settings/billing" && can(BILLING_VIEW_PERMISSION);
    if (item.to === "/loyalty" && gates.role !== "owner") return false;
    if (item.to === "/assistant" && (!gates.assistantEnabled || !gates.advancedReports)) return false;
    if (item.to === "/replenishment" && !gates.advancedReports) return false;
    if (item.permission === CUSTOMERS_VIEW_PERMISSION && !can(CUSTOMERS_VIEW_PERMISSION)) return false;
    if (item.permission === INVENTORY_ADJUST_PERMISSION && !can(INVENTORY_ADJUST_PERMISSION)) return false;
    if (item.permission === "reports.view_all") return can(REPORTS_VIEW_ALL_PERMISSION);
    if (item.permission === "billing.view") return can(BILLING_VIEW_PERMISSION);
    if (item.permission === "expenses.manage" && !can(EXPENSES_MANAGE_PERMISSION)) return false;
    if (item.permission === CUSTOMER_ORDER_VIEW_PERMISSION && !can(CUSTOMER_ORDER_VIEW_PERMISSION)) return false;
    if (item.permission === APPOINTMENTS_OPERATE_PERMISSION && !can(APPOINTMENTS_OPERATE_PERMISSION)) return false;
    if (item.feature === "margin_reports" && !gates.marginReportsEnabled) return false;
    if (item.feature === "customer_orders" && !gates.customerOrdersEnabled) return false;
    return true;
  });
}

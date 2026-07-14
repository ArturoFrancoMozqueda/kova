// Réplica visual (decorativa) del AppShell real (layout/AppShell.tsx) a escala
// del laptop del showcase: sidebar oscuro con el nav completo del rol owner y
// contenido claro, para que lo que se ve dentro del mockup sea la Kova real.
// Los labels vienen de las MISMAS claves de copy que usa el shell (si cambian
// allá, cambian aquí). Los colores son los tokens reales del sidebar en
// styles.css (#0F1117 / #F0F4FF / #23283A / #1E2330 / #8892A4) — hardcodeados
// porque este frame es un mockup autocontenido, no una vista de la app.
// El contenido aplica themeVars("light") para que los previews en vivo se
// rendericen en el tema claro del producto real. Sin NavLinks ni interacción:
// puro chrome, aria-hidden lo aporta el stage que lo contiene.
import type { ReactNode } from "react";
import {
  BarChart3,
  ClipboardList,
  Clock,
  CreditCard,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Settings,
  ShoppingCart,
} from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { copy } from "@/i18n/messages";
import { themeVars } from "@/landing/landingTheme";

export type ShowcaseAppNav =
  | "dashboard"
  | "register"
  | "catalog"
  | "orders"
  | "inventory"
  | "shifts"
  | "reports"
  | "settings"
  | "billing";

// Orden exacto del nav para owner (AppShell.tsx adminNavItems).
const NAV_ITEMS: Array<{ id: ShowcaseAppNav; label: string; Icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: copy.app.dashboard, Icon: LayoutDashboard },
  { id: "register", label: copy.register.title, Icon: ShoppingCart },
  { id: "catalog", label: copy.catalog.title, Icon: LayoutGrid },
  { id: "orders", label: copy.orderList.title, Icon: ClipboardList },
  { id: "inventory", label: copy.inventoryView.title, Icon: Package },
  { id: "shifts", label: copy.shiftView.title, Icon: Clock },
  { id: "reports", label: copy.reportsView.title, Icon: BarChart3 },
  { id: "settings", label: copy.app.settings, Icon: Settings },
  { id: "billing", label: copy.billingView.title, Icon: CreditCard },
];

const OWNER_NAME = "Mariana";
const OWNER_ROLE = "Propietaria";

export default function ShowcaseAppFrame({
  active,
  children,
}: {
  active: ShowcaseAppNav;
  /** El preview en vivo (y opcionalmente el cursor decorativo como sibling). */
  children: ReactNode;
}) {
  return (
    <div className="ksw-app">
      <div className="ksw-app-sidebar">
        <div className="ksw-app-brand">
          <LogoMark size={20} circuitColor="#F0F4FF" coreColor="var(--kova-blue)" />
          <span style={{ minWidth: 0 }}>
            <span className="ksw-app-eyebrow">kova</span>
            <span className="ksw-app-tenant">Sweet Home</span>
          </span>
        </div>
        <div className="ksw-app-nav">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <span className="ksw-app-nav-item" data-active={id === active ? "true" : "false"} key={id}>
              <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </span>
          ))}
        </div>
        <div className="ksw-app-user">
          <span className="ksw-app-avatar">{OWNER_NAME[0]}</span>
          <span style={{ minWidth: 0 }}>
            <span className="ksw-app-username">{OWNER_NAME}</span>
            <span className="ksw-app-userrole">{OWNER_ROLE}</span>
          </span>
        </div>
      </div>
      <div className="ksw-app-content" style={themeVars("light")}>
        <div className="ksw-app-preview">{children}</div>
      </div>
    </div>
  );
}

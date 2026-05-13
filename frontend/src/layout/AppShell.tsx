import { NavLink, Outlet } from "react-router-dom";
import { copy } from "../i18n/messages";
import { useAuth } from "../auth/useAuth";

const navItems = [
  { to: "/register", label: copy.register.title },
  { to: "/catalog", label: copy.catalog.title },
  { to: "/orders", label: copy.orderList.title },
  { to: "/inventory", label: copy.inventoryView.title },
  { to: "/shifts", label: copy.shiftView.title },
  { to: "/reports", label: copy.reportsView.title },
  { to: "/settings/billing", label: copy.billingView.title },
];

export default function AppShell() {
  const { state, logout } = useAuth();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const userEmail = state.status === "authenticated" ? state.user.email : "";

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-block">
          <span className="brand-mark">POS</span>
          <div>
            <p className="eyebrow">{copy.app.offlineShell}</p>
            <strong>{tenantName || copy.app.homeTitle}</strong>
          </div>
        </div>

        <nav className="app-nav" aria-label={copy.auth.accountNavigation}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p className="muted">{userEmail}</p>
          <button type="button" onClick={() => void logout()}>
            {copy.register.logout}
          </button>
        </div>
      </aside>
      <div className="app-stage">
        <Outlet />
      </div>
    </div>
  );
}

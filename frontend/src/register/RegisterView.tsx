import { Link } from "react-router-dom";
import { CATALOG_CREATE_PERMISSION, usePermission } from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { copy } from "../i18n/messages";

export default function RegisterView() {
  const { state, logout } = useAuth();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const canManageCatalog = usePermission(CATALOG_CREATE_PERMISSION);

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tenantName}</p>
          <h1>{copy.register.title}</h1>
        </div>
        <nav className="button-row" aria-label={copy.auth.accountNavigation}>
          {canManageCatalog && (
            <Link className="text-link" to="/catalog">
              {copy.register.manageCatalog}
            </Link>
          )}
          <button type="button" className="text-link" onClick={() => void logout()}>
            {copy.register.logout}
          </button>
        </nav>
      </header>

      <div className="register-shell">
        <section className="panel register-catalog" aria-label={copy.register.catalog}>
          <h2>{copy.register.catalog}</h2>
          <p className="muted">{copy.register.catalogPlaceholder}</p>
        </section>

        <section className="panel register-cart" aria-label={copy.register.cart}>
          <h2>{copy.register.cart}</h2>
          <p className="muted">{copy.register.cartPlaceholder}</p>
          <div className="cart-footer">
            <p>
              <span className="muted">{copy.register.total}</span>
              <strong>$0.00</strong>
            </p>
            <button type="button" disabled>
              {copy.register.charge}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

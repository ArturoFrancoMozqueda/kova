import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CATALOG_CREATE_PERMISSION,
  ORDER_CREATE_PERMISSION,
  usePermission,
} from "../auth/permissions";
import { useAuth } from "../auth/useAuth";
import { listProducts } from "../catalog/api";
import type { Product } from "../catalog/types";
import { copy } from "../i18n/messages";
import { createOrder } from "../orders/api";
import { formatMoney } from "../orders/format";
import type { Order } from "../orders/types";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Product[] };

type CartItem = {
  product: Product;
  quantity: number;
};

type PaymentMethod = "cash" | "bank_transfer" | "manual_card";

function moneyToCents(value: string): number {
  const normalized = value.trim() || "0";
  const [whole = "0", fraction = ""] = normalized.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(`${fraction}00`.slice(0, 2), 10);
}

function centsToMoney(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export default function RegisterView() {
  const { state, logout } = useAuth();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const canManageCatalog = usePermission(CATALOG_CREATE_PERMISSION);
  const canCreateOrders = usePermission(ORDER_CREATE_PERMISSION);

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashTendered, setCashTendered] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

  const load = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const products = (await listProducts()).filter((product) => product.is_active);
      setLoadState({ status: "ready", products });
    } catch {
      setLoadState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const totalCents = useMemo(
    () =>
      cartItems.reduce(
        (sum, item) => sum + moneyToCents(item.product.price_amount) * item.quantity,
        0,
      ),
    [cartItems],
  );
  const totalAmount = centsToMoney(totalCents);
  const tenderedCents = moneyToCents(cashTendered);
  const changeDueCents =
    paymentMethod === "cash" && tenderedCents >= totalCents ? tenderedCents - totalCents : 0;
  const cashIsValid = paymentMethod !== "cash" || tenderedCents >= totalCents;

  const addProduct = (product: Product) => {
    setCart((current) => {
      const existing = current[product.id];
      return {
        ...current,
        [product.id]: {
          product,
          quantity: existing ? existing.quantity + 1 : 1,
        },
      };
    });
    setCompletedOrder(null);
    setNotice(null);
  };

  const updateQuantity = (productId: string, quantity: number) => {
    setCart((current) => {
      if (quantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      const item = current[productId];
      if (!item) return current;
      return { ...current, [productId]: { ...item, quantity } };
    });
  };

  const removeItem = (productId: string) => {
    setCart((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  };

  const resetSale = () => {
    setCart({});
    setPaymentMethod("cash");
    setCashTendered("");
    setReference("");
    setNotice(null);
    setCompletedOrder(null);
  };

  const submitSale = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreateOrders || cartItems.length === 0 || !cashIsValid) {
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const order = await createOrder({
        items: cartItems.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
        })),
        payments: [
          {
            method: paymentMethod,
            amount: totalAmount,
            amount_tendered: paymentMethod === "cash" ? centsToMoney(tenderedCents) : null,
            reference: paymentMethod === "cash" ? null : reference.trim() || null,
          },
        ],
      });
      setCompletedOrder(order);
      setNotice(copy.register.saleComplete);
      setCart({});
      setCashTendered("");
      setReference("");
    } catch {
      setNotice(copy.register.saleError);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadState.status === "loading") {
    return <main aria-busy="true">{copy.register.loading}</main>;
  }

  if (loadState.status === "error") {
    return (
      <main className="page">
        <p role="alert">{copy.register.loadError}</p>
        <button type="button" onClick={() => void load()}>
          {copy.register.retry}
        </button>
      </main>
    );
  }

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

      {notice ? <p className="notice" role="status">{notice}</p> : null}

      <div className="register-shell">
        <section className="panel register-catalog" aria-label={copy.register.catalog}>
          <h2>{copy.register.catalog}</h2>
          {loadState.products.length === 0 ? (
            <p className="muted">{copy.register.catalogPlaceholder}</p>
          ) : (
            <div className="product-grid">
              {loadState.products.map((product) => (
                <article className="data-card sellable-product" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    {product.sku ? <p className="muted">{product.sku}</p> : null}
                  </div>
                  <strong>{formatMoney(product.price_amount)}</strong>
                  <button type="button" onClick={() => addProduct(product)}>
                    {copy.register.add}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel register-cart" aria-label={copy.register.cart}>
          <h2>{copy.register.cart}</h2>
          {cartItems.length === 0 ? (
            <p className="muted">{copy.register.cartPlaceholder}</p>
          ) : (
            <ul className="cart-list">
              {cartItems.map((item) => (
                <li className="cart-line" key={item.product.id}>
                  <div>
                    <strong>{item.product.name}</strong>
                    <p className="muted">{formatMoney(item.product.price_amount)}</p>
                  </div>
                  <label>
                    {copy.register.quantity}
                    <input
                      min={1}
                      type="number"
                      value={item.quantity}
                      onChange={(event) =>
                        updateQuantity(item.product.id, Number.parseInt(event.target.value || "0", 10))
                      }
                    />
                  </label>
                  <strong>
                    {formatMoney(
                      centsToMoney(moneyToCents(item.product.price_amount) * item.quantity),
                    )}
                  </strong>
                  <button type="button" onClick={() => removeItem(item.product.id)}>
                    {copy.register.remove}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="checkout-panel" onSubmit={(event) => void submitSale(event)}>
            <div className="cart-footer">
              <p>
                <span className="muted">{copy.register.total}</span>
                <strong>{formatMoney(totalAmount)}</strong>
              </p>
              <button type="submit" disabled={!canCreateOrders || cartItems.length === 0 || !cashIsValid || submitting}>
                {submitting ? copy.register.salePending : copy.register.completeSale}
              </button>
            </div>

            {!canCreateOrders ? <p className="status-warn">{copy.register.permissionHidden}</p> : null}

            <div className="payment-grid">
              <label>
                {copy.register.paymentMethod}
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                  <option value="cash">{copy.register.cash}</option>
                  <option value="bank_transfer">{copy.register.bankTransfer}</option>
                  <option value="manual_card">{copy.register.manualCard}</option>
                </select>
              </label>

              {paymentMethod === "cash" ? (
                <>
                  <label>
                    {copy.register.amountTendered}
                    <input
                      min="0"
                      step="0.01"
                      type="number"
                      value={cashTendered}
                      onChange={(event) => setCashTendered(event.target.value)}
                    />
                  </label>
                  <div className="payment-summary">
                    <span className="muted">{copy.register.changeDue}</span>
                    <strong>{formatMoney(centsToMoney(changeDueCents))}</strong>
                  </div>
                  {!cashIsValid && cartItems.length > 0 ? (
                    <p className="status-warn">{copy.register.cashTooLow}</p>
                  ) : null}
                </>
              ) : (
                <label>
                  {copy.register.paymentReference}
                  <input
                    placeholder={copy.register.optionalReference}
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </label>
              )}
            </div>
          </form>

          {completedOrder ? (
            <section className="sale-result" aria-label={copy.register.saleComplete}>
              <strong>{copy.register.saleComplete}</strong>
              <div className="button-row">
                <Link className="text-link" to={`/orders/${completedOrder.id}`}>
                  {copy.register.openOrder}
                </Link>
                <button type="button" onClick={resetSale}>
                  {copy.register.newSale}
                </button>
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}

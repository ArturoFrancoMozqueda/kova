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
import { formatMoney } from "../orders/format";
import type { Order } from "../orders/types";
import { OfflineIndicator } from "../offline/OfflineIndicator";
import { queueOfflineSale } from "../offline/queue";
import { syncOfflineSales } from "../offline/sync";
import { triggerSync } from "../offline/syncWorker";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Product[] };

type CartItem = {
  product: Product;
  quantity: number;
};

type PaymentMethod = "cash" | "bank_transfer" | "manual_card";

type PaymentDraft = {
  id: string;
  method: PaymentMethod;
  amount: string;
  amountTendered: string;
  reference: string;
};

let nextPaymentDraftId = 0;

function createPaymentDraft(method: PaymentMethod, amount = ""): PaymentDraft {
  nextPaymentDraftId += 1;
  return {
    id: `payment-${nextPaymentDraftId}`,
    method,
    amount,
    amountTendered: "",
    reference: "",
  };
}

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
  const [splitPaymentsEnabled, setSplitPaymentsEnabled] = useState(false);
  const [splitPayments, setSplitPayments] = useState<PaymentDraft[]>([
    createPaymentDraft("cash"),
  ]);
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
    void triggerSync(); // flush any pending offline sales on mount
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
  const splitPaymentTotalCents = useMemo(
    () => splitPayments.reduce((sum, payment) => sum + moneyToCents(payment.amount), 0),
    [splitPayments],
  );
  const splitRemainingCents = totalCents - splitPaymentTotalCents;
  const splitCashIsValid = splitPayments.every(
    (payment) =>
      payment.method !== "cash" ||
      moneyToCents(payment.amountTendered) >= moneyToCents(payment.amount),
  );
  const splitHasPayment = splitPayments.some((payment) => moneyToCents(payment.amount) > 0);
  const splitTotalMatches = splitPaymentTotalCents === totalCents;
  const splitIsValid =
    !splitPaymentsEnabled || (splitHasPayment && splitTotalMatches && splitCashIsValid);
  const canSubmitSale =
    canCreateOrders &&
    cartItems.length > 0 &&
    (splitPaymentsEnabled ? splitIsValid : cashIsValid) &&
    !submitting;

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

  const toggleSplitPayments = (enabled: boolean) => {
    setSplitPaymentsEnabled(enabled);
    if (enabled) {
      setSplitPayments([
        {
          ...createPaymentDraft(paymentMethod, totalAmount),
          amountTendered: paymentMethod === "cash" ? cashTendered || totalAmount : "",
          reference: paymentMethod === "cash" ? "" : reference,
        },
      ]);
    }
  };

  const updateSplitPayment = (
    paymentId: string,
    patch: Partial<Omit<PaymentDraft, "id">>,
  ) => {
    setSplitPayments((current) =>
      current.map((payment) => (payment.id === paymentId ? { ...payment, ...patch } : payment)),
    );
  };

  const addSplitPayment = () => {
    setSplitPayments((current) => [
      ...current,
      createPaymentDraft("bank_transfer", centsToMoney(Math.max(splitRemainingCents, 0))),
    ]);
  };

  const removeSplitPayment = (paymentId: string) => {
    setSplitPayments((current) =>
      current.length === 1 ? current : current.filter((payment) => payment.id !== paymentId),
    );
  };

  const resetSale = () => {
    setCart({});
    setPaymentMethod("cash");
    setCashTendered("");
    setReference("");
    setSplitPaymentsEnabled(false);
    setSplitPayments([createPaymentDraft("cash")]);
    setNotice(null);
    setCompletedOrder(null);
  };

  const submitSale = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmitSale) return;

    setSubmitting(true);
    setNotice(null);

    const sale = {
      items: cartItems.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
      })),
      payments: splitPaymentsEnabled
        ? splitPayments
            .filter((payment) => moneyToCents(payment.amount) > 0)
            .map((payment) => ({
              method: payment.method,
              amount: centsToMoney(moneyToCents(payment.amount)),
              ...(payment.method === "cash"
                ? { amount_tendered: centsToMoney(moneyToCents(payment.amountTendered)) }
                : { reference: payment.reference.trim() || undefined }),
            }))
        : [
            {
              method: paymentMethod,
              amount: totalAmount,
              ...(paymentMethod === "cash"
                ? { amount_tendered: centsToMoney(tenderedCents) }
                : { reference: reference.trim() || undefined }),
            },
          ],
    };

    // Persist locally first — the sale is safe regardless of network
    const queueItem = await queueOfflineSale(sale);

    // Clear cart immediately
    setCart({});
    setCashTendered("");
    setReference("");
    setSplitPaymentsEnabled(false);
    setSplitPayments([createPaymentDraft("cash")]);

    try {
      const results = await syncOfflineSales([queueItem]);
      const result = results[0];
      if (result.status === "synced" && result.order) {
        setCompletedOrder(result.order as Order);
        setNotice(copy.register.saleComplete);
      } else {
        setNotice(copy.register.saleQueued);
      }
    } catch {
      // Network error — sale is safe in Dexie; sync worker retries on next mount or online event
      setNotice(copy.register.saleQueued);
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
          <OfflineIndicator />
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
              <button type="submit" disabled={!canSubmitSale}>
                {submitting ? copy.register.salePending : copy.register.completeSale}
              </button>
            </div>

            {!canCreateOrders ? <p className="status-warn">{copy.register.permissionHidden}</p> : null}

            <div className="payment-grid">
              <label className="inline-toggle">
                <input
                  checked={splitPaymentsEnabled}
                  type="checkbox"
                  onChange={(event) => toggleSplitPayments(event.target.checked)}
                />
                {copy.register.splitPayment}
              </label>

              {splitPaymentsEnabled ? (
                <div className="split-payment-list">
                  {splitPayments.map((payment, index) => (
                    <fieldset className="split-payment-row" key={payment.id}>
                      <legend>{`${copy.register.payment} ${index + 1}`}</legend>
                      <label>
                        {copy.register.method}
                        <select
                          value={payment.method}
                          onChange={(event) =>
                            updateSplitPayment(payment.id, {
                              method: event.target.value as PaymentMethod,
                              amountTendered: "",
                              reference: "",
                            })
                          }
                        >
                          <option value="cash">{copy.register.cash}</option>
                          <option value="bank_transfer">{copy.register.bankTransfer}</option>
                          <option value="manual_card">{copy.register.manualCard}</option>
                        </select>
                      </label>
                      <label>
                        {copy.register.amount}
                        <input
                          min="0"
                          step="0.01"
                          type="number"
                          value={payment.amount}
                          onChange={(event) =>
                            updateSplitPayment(payment.id, { amount: event.target.value })
                          }
                        />
                      </label>
                      {payment.method === "cash" ? (
                        <label>
                          {copy.register.amountTendered}
                          <input
                            min="0"
                            step="0.01"
                            type="number"
                            value={payment.amountTendered}
                            onChange={(event) =>
                              updateSplitPayment(payment.id, {
                                amountTendered: event.target.value,
                              })
                            }
                          />
                        </label>
                      ) : (
                        <label>
                          {copy.register.paymentReference}
                          <input
                            placeholder={copy.register.optionalReference}
                            value={payment.reference}
                            onChange={(event) =>
                              updateSplitPayment(payment.id, { reference: event.target.value })
                            }
                          />
                        </label>
                      )}
                      <button
                        disabled={splitPayments.length === 1}
                        type="button"
                        onClick={() => removeSplitPayment(payment.id)}
                      >
                        {copy.register.removePayment}
                      </button>
                    </fieldset>
                  ))}

                  <button type="button" onClick={addSplitPayment}>
                    {copy.register.addPayment}
                  </button>

                  <div className="payment-summary">
                    <span className="muted">{copy.register.paymentTotal}</span>
                    <strong>{formatMoney(centsToMoney(splitPaymentTotalCents))}</strong>
                    <span className="muted">{copy.register.remaining}</span>
                    <strong>{formatMoney(centsToMoney(Math.abs(splitRemainingCents)))}</strong>
                  </div>
                  {!splitTotalMatches && cartItems.length > 0 ? (
                    <p className="status-warn">{copy.register.splitTotalMismatch}</p>
                  ) : null}
                  {!splitCashIsValid && cartItems.length > 0 ? (
                    <p className="status-warn">{copy.register.cashTooLow}</p>
                  ) : null}
                </div>
              ) : (
                <>
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
                </>
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

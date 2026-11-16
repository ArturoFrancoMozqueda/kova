import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { invalidateBillingSubscription } from "@/billing/api";
import { offlineDb } from "@/offline/db";
import { prepareRefundIntent } from "./refundIntents";

const order = {
  id: "order-1",
  tenant_id: "tenant-1",
  status: "completed",
  subtotal_amount: "50.00",
  total_amount: "50.00",
  items: [
    {
      id: "item-1",
      product_id: "product-1",
      product_name: "Concha",
      quantity: 1,
      unit_price_amount: "25.00",
      line_total_amount: "25.00",
      modifiers: [],
    },
    {
      id: "item-2",
      product_id: "product-2",
      product_name: "Roll",
      quantity: 1,
      unit_price_amount: "25.00",
      line_total_amount: "25.00",
      modifiers: [],
    },
  ],
  payments: [],
};

const receipt = {
  order_id: "order-1",
  receipt_number: "ABC123",
  tenant_name: "Bakery",
  created_at: "2026-05-08T00:00:00Z",
  status: "completed",
  items: [
    {
      product_name: "Latte",
      quantity: 1,
      unit_price_amount: "58.00",
      line_total_amount: "58.00",
      modifiers: [
        {
          modifier_group_name: "Milk",
          modifier_option_name: "Oat",
          price_delta_amount: "8.00",
        },
      ],
    },
  ],
  subtotal_amount: "50.00",
  total_amount: "50.00",
  payments: [
    {
      method: "cash",
      amount_amount: "50.00",
      amount_tendered_amount: "50.00",
      change_due_amount: "0.00",
      reference: null,
    },
  ],
  total_tendered: "50.00",
  total_change: "0.00",
  refunds: [],
  void: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function meResponse(role: string) {
  return {
    authenticated: true,
    user: { id: "user-1", email: "test@bakery.com", tenant_id: "tenant-1", role },
    tenant_id: "tenant-1",
    tenant_name: "Bakery",
  };
}

const billingAllowedResponse = {
  plan: { name: "Standard Plan", amount_minor_units: 29900, currency: "MXN", interval: "month" },
  subscription: null,
  access: {
    allowed: true,
    reason: "active",
    trialing: false,
    trial_ends_at: null,
    blocked_at: null,
    recovery_path: "/settings/billing",
  },
};

// URL-pattern → response queue. First-match wins. Each pattern has its own queue
// so the order BillingBanner vs OrderDetail fires their effects does not matter.
function setupFetchMock(routes: Record<string, unknown[]>) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([pattern, list]) => [pattern, [...list]]),
  );
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request | URL).toString();
    for (const [pattern, queue] of Object.entries(queues)) {
      if (url.includes(pattern)) {
        const next = queue.shift();
        if (next === undefined) {
          throw new Error(`Exhausted fetch mocks for ${pattern} (called ${url})`);
        }
        if (next instanceof Response) return next;
        if (next instanceof Error) throw next;
        return jsonResponse(next);
      }
    }
    throw new Error(`No fetch mock matched ${url}`);
  });
}

function mockInitialLoad(currentReceipt: unknown = receipt, role = "cashier") {
  return setupFetchMock({
    "/api/v1/auth/session": [meResponse(role)],
    "/api/v1/billing/subscription": [billingAllowedResponse],
    "/api/v1/orders/order-1/receipt": [currentReceipt],
    "/api/v1/orders/order-1": [order],
  });
}

beforeEach(async () => { await offlineDb.refund_intents.clear(); });

afterEach(async () => {
  cleanup();
  await offlineDb.refund_intents.clear();
  invalidateBillingSubscription();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.pushState(null, "", "/");
});

async function openRefundModal() {
  const button = await screen.findByRole("button", { name: "Devolver" }, { timeout: 5_000 });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

beforeAll(async () => {
  // This suite renders through App to exercise the real auth/permission route.
  // Warm only the lazy modules it owns so whole-suite transform pressure does
  // not consume the assertion timeout before the route itself starts loading.
  await Promise.all([
    import("../layout/AppShell"),
    import("./OrderDetail"),
  ]);
});

describe("OrderDetail", () => {
  it("retains the durable retry when billing blocks an uncertain refund", async () => {
    const { intent } = await prepareRefundIntent({ tenantId: "tenant-1", userId: "user-1", branchId: "tenant-1", orderId: "order-1" }, { reason: "customer_return", refund_payment_method: "cash", items: [{ order_item_id: "item-1", quantity: 1 }] });
    setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [jsonResponse({ detail: "payment_required" }, 402)],
      "/api/v1/orders/order-1/receipt": [receipt],
      "/api/v1/orders/order-1": [order],
    });
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar devolución pendiente" }));
    fireEvent.click(screen.getByRole("button", { name: /registrar devolución/i }));
    expect(await screen.findByText(/activa tu plan para volver/i)).toBeInTheDocument();
    await waitFor(async () => expect(await offlineDb.refund_intents.get(intent.id)).toEqual(intent));
  });
  it("only starts a corrected refund after reconciliation fences the uncertain original", async () => {
    const confirmed = { id: "refund-new", order_id: "order-1", reason: "customer_return", refunded_amount: "25.00", items: [], created_at: receipt.created_at };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds/reconcile": [{ status: "cancelled", refund: null }],
      "/api/v1/orders/order-1/refunds": [new TypeError("Response lost"), jsonResponse({ detail: "Validation failed" }, 422), confirmed],
      "/api/v1/orders/order-1/receipt": [receipt, receipt, { ...receipt, refunds: [confirmed] }],
      "/api/v1/orders/order-1": [order, order, order],
    });
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);
    await openRefundModal();
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    const submit = screen.getByRole("button", { name: /registrar devolución/i });
    fireEvent.click(submit);
    expect(await screen.findByText(/parece que no hay conexión/i)).toBeInTheDocument();
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Revisar resultado y desbloquear" }));
    expect(await screen.findByText(/ya puedes preparar una nueva/i)).toBeInTheDocument();
    await openRefundModal();
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /registrar devolución/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/refunds"));
      expect(calls).toHaveLength(4);
      const keys = calls.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"));
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).toBe(keys[0]);
      expect(keys[3]).not.toBe(keys[0]);
    });
  });
  it.each([403, 409, 429, 422])("keeps the original refund key when a retry is rejected with %s", async (status) => {
    const confirmed = { id: "refund-1", order_id: "order-1", reason: "customer_return", refunded_amount: "25.00", items: [], created_at: receipt.created_at };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [new TypeError("Response lost"), jsonResponse({ detail: "Retry unavailable" }, status), confirmed],
      "/api/v1/orders/order-1/receipt": [receipt, { ...receipt, refunds: [confirmed] }],
      "/api/v1/orders/order-1": [order, order],
    });
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);
    await openRefundModal();
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    const submit = screen.getByRole("button", { name: /registrar devolución/i });
    fireEvent.click(submit);
    expect(await screen.findByText(/parece que no hay conexión/i)).toBeInTheDocument();
    fireEvent.click(submit);
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/refunds"));
      expect(calls).toHaveLength(2);
      expect(submit).toBeEnabled();
    });
    expect(screen.getByLabelText("Concha Cantidad")).toBeDisabled();
    expect(await offlineDb.refund_intents.count()).toBe(1);
    fireEvent.click(submit);
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/refunds"));
      expect(calls).toHaveLength(3);
      const keys = calls.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key"));
      expect(new Set(keys).size).toBe(1);
      expect(calls[2][1]?.body).toBe(calls[0][1]?.body);
    });
    await waitFor(async () => expect(await offlineDb.refund_intents.count()).toBe(0));
  });
  it("can confirm a stored retry even when the refreshed receipt is already fully refunded", async () => {
    const onlyItem = { ...order, items: [order.items[0]], subtotal_amount: "25.00", total_amount: "25.00" };
    const confirmed = { id: "refund-1", order_id: "order-1", reason: "customer_return", refunded_amount: "25.00", items: [{ order_item_id: "item-1", quantity: 1, unit_price_amount: "25.00", line_total_amount: "25.00" }], created_at: receipt.created_at };
    const { intent } = await prepareRefundIntent({ tenantId: "tenant-1", userId: "user-1", branchId: "tenant-1", orderId: "order-1" }, { reason: "customer_return", refund_payment_method: "cash", items: [{ order_item_id: "item-1", quantity: 1 }] });
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [confirmed],
      "/api/v1/orders/order-1/receipt": [{ ...receipt, refunds: [confirmed] }, { ...receipt, refunds: [confirmed] }],
      "/api/v1/orders/order-1": [onlyItem, onlyItem],
    });
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar devolución pendiente" }));
    expect(screen.getByLabelText("Concha Cantidad")).toHaveValue(1);
    expect(screen.getByLabelText("Concha Cantidad")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /registrar devolución/i }));
    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input]) => String(input).includes("/refunds"));
      expect(new Headers(request?.[1]?.headers).get("Idempotency-Key")).toBe(intent.idempotencyKey);
    });
    await waitFor(async () => expect(await offlineDb.refund_intents.count()).toBe(0));
  });
  it("recovers an uncertain partial refund after closing and remounting the detail", async () => {
    const twoUnits = { ...order, items: [{ ...order.items[0], quantity: 2, line_total_amount: "50.00" }] };
    const recorded = { id: "refund-1", order_id: "order-1", reason: "customer_return", refunded_amount: "25.00", items: [{ order_item_id: "item-1", quantity: 1, unit_price_amount: "25.00", line_total_amount: "25.00" }], created_at: receipt.created_at };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner"), meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [new TypeError("Response lost"), recorded],
      "/api/v1/orders/order-1/receipt": [receipt, { ...receipt, refunds: [recorded] }, { ...receipt, refunds: [recorded] }],
      "/api/v1/orders/order-1": [twoUnits, twoUnits, twoUnits],
    });
    window.history.pushState(null, "", "/orders/order-1");
    const first = render(<App />);
    await openRefundModal();
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /registrar devolución/i }));
    expect(await screen.findByText(/parece que no hay conexión/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Revisar devolución pendiente" }));
    expect(screen.getByLabelText("Concha Cantidad")).toHaveValue(1);
    expect(screen.getByLabelText("Concha Cantidad")).toBeDisabled();
    first.unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Revisar devolución pendiente" }));
    expect(screen.getByLabelText("Concha Cantidad")).toHaveValue(1);
    fireEvent.click(screen.getByRole("button", { name: /registrar devolución/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/refunds"));
      expect(calls).toHaveLength(2);
      expect(new Headers(calls[1][1]?.headers).get("Idempotency-Key")).toBe(new Headers(calls[0][1]?.headers).get("Idempotency-Key"));
      expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
    });
    await waitFor(async () => expect(await offlineDb.refund_intents.count()).toBe(0));
  });
  it("offers only quantities that remain after earlier partial refunds", async () => {
    mockInitialLoad({
      ...receipt,
      refunds: [{
        id: "refund-1", reason: "customer_return", refunded_amount: "25.00", created_at: receipt.created_at,
        items: [{ order_item_id: "item-1", quantity: 1, unit_price_amount: "25.00", line_total_amount: "25.00" }],
      }],
    }, "manager");
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);

    await openRefundModal();

    expect(screen.queryByRole("spinbutton", { name: /Concha/ })).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /Roll/ })).toHaveAttribute("max", "1");
  });

  it("does not offer another refund when all units have been returned", async () => {
    mockInitialLoad({
      ...receipt,
      refunds: [{
        id: "refund-1", reason: "customer_return", refunded_amount: "50.00", created_at: receipt.created_at,
        items: order.items.map((item) => ({ order_item_id: item.id, quantity: item.quantity, unit_price_amount: item.unit_price_amount, line_total_amount: item.line_total_amount })),
      }],
    }, "manager");
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);

    await screen.findByRole("heading", { name: /detalle de la venta/i });
    expect(screen.queryByRole("button", { name: "Devolver" })).not.toBeInTheDocument();
  });

  it("offers owner invoice preparation from a completed ticket without mutating the sale", async () => {
    const fetchMock = mockInitialLoad(receipt, "owner");
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);
    const action = await screen.findByRole("link", { name: "Preparar factura" });
    expect(action).toHaveAttribute("href", "/settings/integrations?order_id=order-1");
    expect(fetchMock.mock.calls.every(([, options]) => !options || options.method !== "POST")).toBe(true);
  });

  it.each(["manager", "cashier"])("does not offer fiscal preparation to %s", async (role) => {
    mockInitialLoad(receipt, role);
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);
    await screen.findByRole("heading", { name: /detalle de la venta/i });
    expect(screen.queryByRole("link", { name: "Preparar factura" })).not.toBeInTheDocument();
  });

  it.each(["voided", "refunded"])("does not offer invoice preparation on a %s ticket", async (state) => {
    const changed = state === "voided" ? { ...receipt, status: "voided" } : { ...receipt, refunds: [{ id: "refund-1", reason: "customer_return", refunded_amount: "25.00", created_at: receipt.created_at, items: [] }] };
    mockInitialLoad(changed, "owner");
    window.history.pushState(null, "", "/orders/order-1");
    render(<App />);
    await screen.findByRole("heading", { name: /detalle de la venta/i });
    expect(screen.queryByRole("link", { name: "Preparar factura" })).not.toBeInTheDocument();
  });

  it("shows receipt refunds and hides actions without permission", async () => {
    mockInitialLoad({
      ...receipt,
      refunds: [
        {
          id: "refund-1",
          reason: "customer_return",
          refunded_amount: "25.00",
          created_at: "2026-05-08T01:00:00Z",
          items: [
            {
              order_item_id: "item-1",
              quantity: 1,
              unit_price_amount: "25.00",
              line_total_amount: "25.00",
            },
          ],
        },
      ],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /detalle de la venta/i })).toBeInTheDocument();
    expect(screen.getByText(/devoluci[oó]n de cliente/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Devolver" })).not.toBeInTheDocument();
    expect(screen.getByText(/no puede devolver ni cancelar/i)).toBeInTheDocument();
    expect(await screen.findByText(/Oat/)).toBeInTheDocument();
  });

  it("does not opt the order receipt into the register's print-in reveal", async () => {
    // ReceiptTemplate carries inert data-tkt-band markers for the register's
    // sale-completed animation. This is a reference surface, so the .kv-tkt-reveal
    // opt-in must never appear here — otherwise every order you open replays a
    // receipt printing itself.
    mockInitialLoad();
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    await screen.findByRole("heading", { name: /detalle de la venta/i });
    expect(document.querySelector(".kv-tkt-reveal")).toBeNull();
    expect(document.querySelector("[data-tkt-band]")).not.toBeNull();
  });

  it("submits a refund and reloads the receipt", async () => {
    const refundResponse = {
      id: "refund-1",
      order_id: "order-1",
      reason: "customer_return",
      refunded_amount: "25.00",
      items: [],
      created_at: "2026-05-08T01:00:00Z",
    };
    const reloadedReceipt = {
      ...receipt,
      refunds: [
        {
          id: "refund-1",
          reason: "customer_return",
          refunded_amount: "25.00",
          created_at: "2026-05-08T01:00:00Z",
          items: [],
        },
      ],
    };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [refundResponse],
      "/api/v1/orders/order-1/receipt": [receipt, reloadedReceipt],
      "/api/v1/orders/order-1": [order, order],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    await openRefundModal();
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /registrar devoluci[oó]n/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/orders/order-1/refunds",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/devoluci[oó]n registrada/i)).toBeInTheDocument();
  });

  it("reuses the refund idempotency key after a lost response", async () => {
    const refundResponse = {
      id: "refund-1",
      order_id: "order-1",
      reason: "customer_return",
      refunded_amount: "25.00",
      items: [],
      created_at: "2026-05-08T01:00:00Z",
    };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [new TypeError("Response lost"), refundResponse],
      "/api/v1/orders/order-1/receipt": [receipt, { ...receipt, refunds: [refundResponse] }],
      "/api/v1/orders/order-1": [order, order],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    await openRefundModal();
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    const submit = screen.getByRole("button", { name: /registrar devoluci[oó]n/i });
    fireEvent.click(submit);
    expect(await screen.findByText(/parece que no hay conexi[oó]n/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Concha Cantidad")).toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) =>
        (typeof input === "string" ? input : input.toString()).includes("/refunds"),
      );
      expect(calls).toHaveLength(2);
      const firstHeaders = new Headers((calls[0][1] as RequestInit).headers);
      const secondHeaders = new Headers((calls[1][1] as RequestInit).headers);
      expect(firstHeaders.get("Idempotency-Key")).toBeTruthy();
      expect(secondHeaders.get("Idempotency-Key")).toBe(firstHeaders.get("Idempotency-Key"));
      expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
    });
    expect(await screen.findByText(/devoluci[oó]n registrada/i)).toBeInTheDocument();
  });

  it("keeps the refund intent recoverable when session refresh is temporarily unavailable", async () => {
    const refundResponse = {
      id: "refund-1",
      order_id: "order-1",
      reason: "customer_return",
      refunded_amount: "25.00",
      items: [],
      created_at: "2026-05-08T01:00:00Z",
    };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/auth/refresh": [new Response("temporarily unavailable", { status: 503 })],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/refunds": [
        new Response("unauthorized", { status: 401 }),
        refundResponse,
      ],
      "/api/v1/orders/order-1/receipt": [receipt, { ...receipt, refunds: [refundResponse] }],
      "/api/v1/orders/order-1": [order, order],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    await openRefundModal();
    fireEvent.change(screen.getByLabelText("Concha Cantidad"), { target: { value: "1" } });
    const submit = screen.getByRole("button", { name: /registrar devoluci[oó]n/i });
    fireEvent.click(submit);
    expect(await screen.findByText(/problema de nuestro lado/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Concha Cantidad")).toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) =>
        (typeof input === "string" ? input : input.toString()).includes("/refunds"),
      );
      expect(calls).toHaveLength(2);
      const firstHeaders = new Headers((calls[0][1] as RequestInit).headers);
      const secondHeaders = new Headers((calls[1][1] as RequestInit).headers);
      expect(secondHeaders.get("Idempotency-Key")).toBe(firstHeaders.get("Idempotency-Key"));
      expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
    });
    expect(await screen.findByText(/devoluci[oó]n registrada/i)).toBeInTheDocument();
  });

  it("submits a void after confirmation", async () => {
    const voidResponse = {
      id: "void-1",
      order_id: "order-1",
      reason: "operator_error",
      created_at: "2026-05-08T01:00:00Z",
    };
    const voidedOrder = { ...order, status: "voided" };
    const voidedReceipt = {
      ...receipt,
      status: "voided",
      void: { id: "void-1", reason: "operator_error", created_at: "2026-05-08T01:00:00Z" },
    };
    const fetchMock = setupFetchMock({
      "/api/v1/auth/session": [meResponse("owner")],
      "/api/v1/billing/subscription": [billingAllowedResponse, billingAllowedResponse],
      "/api/v1/orders/order-1/void": [voidResponse],
      "/api/v1/orders/order-1/receipt": [receipt, voidedReceipt],
      "/api/v1/orders/order-1": [order, voidedOrder],
    });
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByLabelText(/revierte el inventario/i));
    fireEvent.click(screen.getByRole("button", { name: /cancelar orden/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/orders/order-1/void",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/venta cancelada/i)).toBeInTheDocument();
    expect(await screen.findByText("Error del operador", { exact: true })).toBeVisible();
    expect(screen.queryByText("operator error", { exact: true })).not.toBeInTheDocument();
  });

  it("explains unavailable actions on voided orders without implying a role problem", async () => {
    const voidedReceipt = {
      ...receipt,
      status: "voided",
      void: { id: "void-1", reason: "operator_error", created_at: "2026-05-08T01:00:00Z" },
    };
    mockInitialLoad(voidedReceipt, "owner");
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    expect(await screen.findByText(/esta venta ya no acepta/i)).toBeInTheDocument();
    expect(screen.queryByText(/tu rol no puede devolver ni cancelar/i)).not.toBeInTheDocument();
  });

  it("reprints the shared receipt from order detail", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => undefined);
    mockInitialLoad(receipt, "owner");
    window.history.pushState(null, "", "/orders/order-1");

    render(<App />);

    expect(await screen.findByText("ABC123")).toBeInTheDocument();
    expect(screen.getByText(/Latte/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /imprimir ticket/i }));

    expect(printSpy).toHaveBeenCalledOnce();
  });
});

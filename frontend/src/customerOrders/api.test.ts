import { afterEach, expect, it, vi } from "vitest";
import { confirmCustomerOrder, createCustomerOrder, updateCustomerOrder } from "./api";
import type { CustomerOrderInput } from "./types";

afterEach(() => vi.unstubAllGlobals());

it("transports the original save and confirmation keys without changing their payloads", async () => {
  const requests = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => Response.json({}),
  );
  vi.stubGlobal("fetch", requests);
  const body: CustomerOrderInput = {
    fulfillment_type: "pickup", source_channel: "counter",
    items: [{ product_id: "product", quantity: 2, modifier_option_ids: [] }],
  };
  await createCustomerOrder(body, "create-attempt");
  await updateCustomerOrder("pedido", { ...body, version: 3 }, "update-attempt");
  await confirmCustomerOrder("pedido", 4, "confirm-attempt");

  expect(requests.mock.calls.map(([url, init]) => ({
    url, method: init?.method, key: new Headers(init?.headers).get("Idempotency-Key"),
    body: JSON.parse(String(init?.body)),
  }))).toEqual([
    { url: "/api/v1/customer-orders", method: "POST", key: "create-attempt", body },
    { url: "/api/v1/customer-orders/pedido", method: "PATCH", key: "update-attempt", body: { ...body, version: 3 } },
    { url: "/api/v1/customer-orders/pedido/confirm", method: "POST", key: "confirm-attempt", body: { version: 4 } },
  ]);
});

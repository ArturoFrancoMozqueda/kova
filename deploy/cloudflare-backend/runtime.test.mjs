import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";

async function browser(email) {
  const cookies = new Map();
  async function request(path, { method = "GET", body, headers = {}, csrf = true } = {}) {
    const outgoing = new Headers(headers);
    outgoing.set("Origin", "https://app.test");
    if (cookies.size) outgoing.set("Cookie", [...cookies].map(([k,v]) => `${k}=${v}`).join("; "));
    if (csrf && cookies.has("csrf_token")) outgoing.set("X-CSRF-Token", cookies.get("csrf_token"));
    if (body !== undefined) outgoing.set("Content-Type", "application/json");
    const response = await SELF.fetch(`https://api.test${path}`, {
      method, headers: outgoing, body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  const signup = await request("/api/v1/auth/signup", { method: "POST", body: {
    email, password: "S3cur3pass!", tenant_name: "QA Workers", accepted_terms: true,
  } });
  expect(signup.status).toBe(201);
  expect((await signup.json()).dev_verification_token).toBeNull();
  const delivered = await env.TEST_MAILBOX.fetch(`https://mailbox.test/?to=${encodeURIComponent(email)}`);
  const { html } = await delivered.json();
  const token = html?.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
  expect(token).toBeTruthy();
  expect((await request("/api/v1/auth/verify", { method: "POST", body: { token } })).status).toBe(200);
  const login = await request("/api/v1/auth/login", { method: "POST", body: {
    email, password: "S3cur3pass!",
  } });
  expect(login.status).toBe(200);
  expect(await login.json()).toEqual({ message: "Logged in." });
  for (const name of ["access_token", "refresh_token"]) {
    const cookie = login.headers.getSetCookie().find(value => value.startsWith(`${name}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  }
  return request;
}

describe("existing API inside Python Durable Objects", () => {
  it("persists commercial intake, inbox drafts and opt-in retention without an external account", async () => {
    const owner = await browser(`commercial-${crypto.randomUUID()}@example.com`);
    async function write(path, method, body) {
      return owner(path, { method, body, headers: { "Idempotency-Key": crypto.randomUUID() } });
    }
    const productResponse = await write("/api/v1/catalog/products", "POST", {
      name: "Producto comercial Workers", price_amount: "42.50", track_inventory: false,
    });
    expect(productResponse.status).toBe(201);
    const product = await productResponse.json();
    const customerResponse = await write("/api/v1/customers", "POST", {
      name: "Cliente comercial Workers", phone: "525550000000",
    });
    expect(customerResponse.status).toBe(201);
    const customer = await customerResponse.json();
    const published = await write("/api/v1/storefront/settings", "PUT", {
      enabled: true, expected_version: 0, title: "Catálogo comercial",
      product_ids: [product.id],
    });
    expect(published.status).toBe(200);
    const { share_path: sharePath } = await published.json();
    const token = sharePath.split("/").at(-1);
    const payload = { submission_id: crypto.randomUUID(), name: "Consulta pública",
      contact: "contacto de prueba", message: "Quisiera una cotización", product_ids: [product.id] };
    const submit = () => SELF.fetch(`https://api.test/api/v1/public/catalog/${token}/requests`, {
      method: "POST", headers: { Origin: "https://app.test", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const captured = await submit();
    expect(captured.status).toBe(201);
    const receipt = await captured.json();
    expect(Object.keys(receipt).sort()).toEqual(["receipt_id", "status"]);
    expect(await (await submit()).json()).toEqual(receipt);
    const requests = await (await owner("/api/v1/crm/requests")).json();
    expect(requests.requests).toHaveLength(1);
    const converted = await write(`/api/v1/crm/requests/${receipt.receipt_id}/resolve`, "POST", {
      expected_version: 1, status: "converted", customer_id: customer.id,
    });
    expect(converted.status).toBe(200);
    const { opportunity_id: opportunityId } = await converted.json();
    const quoteResponse = await write("/api/v1/quotes", "POST", {
      customer_id: customer.id, opportunity_id: opportunityId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      items: [{ product_id: product.id, quantity: 1 }],
    });
    expect(quoteResponse.status).toBe(201);
    const quote = await quoteResponse.json();
    const journey = await (await owner(`/api/v1/quotes/${quote.id}/journey`)).json();
    expect(journey.catalog_request_id).toBe(receipt.receipt_id);
    expect(journey.sale_order_id).toBeNull();
    expect(journey.external_collection_verified).toBe(false);
    const conversationResponse = await write("/api/v1/messaging/conversations", "POST", {
      customer_id: customer.id, subject: "Preparar atención",
    });
    expect(conversationResponse.status).toBe(201);
    const conversation = await conversationResponse.json();
    expect(conversation.automation_paused).toBe(true);
    const draft = await write(`/api/v1/messaging/conversations/${conversation.id}/messages`, "POST", {
      body: "Borrador sin proveedor conectado", purpose: "transactional",
    });
    expect(draft.status).toBe(201);
    expect((await draft.json()).state).toBe("draft");
    const policy = await write("/api/v1/crm/followups/policy", "PUT", {
      enabled: true, expected_version: 0, review_delay_days: 2, rebuy_delay_days: 30,
    });
    expect(policy.status).toBe(200);
    expect(await (await write("/api/v1/crm/followups/process", "POST", {})).json()).toEqual({ created: 0 });
    expect((await (await owner("/api/v1/messaging/readiness")).json()).status).toBe("not_connected");
    expect((await owner("/api/v1/auth/logout", { method: "POST" })).status).toBe(204);
  });

  it("persists branch appointments and owner-configured loyalty without external providers", async () => {
    const owner = await browser(`operations-${crypto.randomUUID()}@example.com`);
    const other = await browser(`operations-other-${crypto.randomUUID()}@example.com`);
    async function write(path, method, body) {
      return owner(path, { method, body, headers: { "Idempotency-Key": crypto.randomUUID() } });
    }
    const customerResponse = await write("/api/v1/customers", "POST", { name: "Cliente agenda" });
    expect(customerResponse.status).toBe(201);
    const customer = await customerResponse.json();
    const resourceResponse = await write("/api/v1/appointments/resources", "POST", {
      name: "Servicio", timezone: "America/Mexico_City",
    });
    expect(resourceResponse.status).toBe(201);
    const resource = await resourceResponse.json();
    const startsAt = new Date(Date.now() + 86400000).toISOString();
    const endsAt = new Date(Date.now() + 90000000).toISOString();
    const booking = { resource_id: resource.id, customer_id: customer.id,
      title: "Visita", starts_at: startsAt, ends_at: endsAt };
    const booked = await write("/api/v1/appointments", "POST", booking);
    expect(booked.status).toBe(201);
    const appointment = await booked.json();
    expect(appointment.status).toBe("scheduled");
    expect((await write("/api/v1/appointments", "POST", booking)).status).toBe(409);
    const isolated = await (await other("/api/v1/appointments")).json();
    expect(isolated.items).toEqual([]);
    expect((await (await owner("/api/v1/loyalty")).json()).policy).toMatchObject({
      enabled: false, version: 0, spend_amount: null, points_per_step: null,
    });
    const policy = await write("/api/v1/loyalty/policy", "PUT", {
      enabled: true, expected_version: 0, spend_amount: "100.00", points_per_step: 1,
    });
    expect(policy.status).toBe(200);
    expect(await (await owner("/api/v1/loyalty/process", { method: "POST" })).json()).toEqual({ created: 0 });
    expect((await (await owner(`/api/v1/loyalty/customers/${customer.id}`)).json()).balance).toBe(0);
    expect((await other(`/api/v1/loyalty/customers/${customer.id}`)).status).toBe(404);
    expect((await owner("/api/v1/auth/logout", { method: "POST" })).status).toBe(204);
    expect((await other("/api/v1/auth/logout", { method: "POST" })).status).toBe(204);
  });

  it("passes production startup checks and reaches Postgres", async () => {
    const health = await SELF.fetch("https://api.test/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", release_sha: "workers-integration-test" });
    const database = await SELF.fetch("https://api.test/health/db");
    expect(database.status).toBe(200);
    expect(await database.json()).toEqual({ status: "ok", db: "reachable" });
  });

  it("keeps unauthenticated requests private and denied", async () => {
    const response = await SELF.fetch("https://api.test/api/v1/auth/me");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
  });

  it("verifies a missing account with production bcrypt cost", async () => {
    const response = await SELF.fetch("https://api.test/api/v1/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.test" },
      body: JSON.stringify({ email: "missing-worker@example.com", password: "synthetic-wrong-password" }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ detail: "Invalid credentials" });
  });

  it("shares rate counters between stubs while isolating different buckets", async () => {
    const name = crypto.randomUUID();
    const first = env.TEST_RATES.getByName(name);
    const second = env.TEST_RATES.getByName(name);
    expect((await first.allow(2, 60)).allowed).toBe(true);
    expect((await second.allow(2, 60)).allowed).toBe(true);
    const rejected = await first.allow(2, 60);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfter).toBeGreaterThan(0);
    expect((await env.TEST_RATES.getByName(crypto.randomUUID()).allow(2, 60)).allowed).toBe(true);
  });

  it("preserves cookie sessions, CSRF, tenant isolation and offline sale idempotency", async () => {
    const owner = await browser(`owner-${crypto.randomUUID()}@example.com`);
    const other = await browser(`other-${crypto.randomUUID()}@example.com`);
    const me = await owner("/api/v1/auth/me");
    expect(me.status).toBe(200);
    const identity = await me.json();
    expect(identity.user.email_verified).toBe(true);
    // Real browsers negotiate gzip. Reports exceed the native middleware's
    // threshold and must still arrive as readable JSON after Fetch encoding.
    const story = await owner("/api/v1/reports/business-story", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(story.status).toBe(200);
    expect((await story.json()).summary).toMatchObject({ net_sales: "0.00" });
    // A configured private bucket must work in Python Workers, including the
    // fail-closed tombstone check that runs before assistant access.
    expect((await owner("/api/v1/assistant/capabilities")).status).toBe(200);
    const tombstone = `deleted-tenants/${identity.tenant_id}`;
    await env.TEST_STORAGE.put(tombstone, "deleted");
    try {
      expect((await owner("/api/v1/assistant/capabilities")).status).toBe(410);
    } finally {
      await env.TEST_STORAGE.delete(tombstone);
    }
    const dashboard = await Promise.all([
      owner("/api/v1/reports/sales-summary"),
      owner("/api/v1/reports/sales-by-hour"),
      owner("/api/v1/auth/session"),
      other("/api/v1/auth/session"),
    ]);
    for (const response of dashboard) expect(response.status).toBe(200);
    expect((await dashboard[2].json()).tenant_id).toBe(identity.tenant_id);
    expect((await dashboard[3].json()).tenant_id).not.toBe(identity.tenant_id);
    // Repeated reload bursts reuse coordinators while prior ASGI responses
    // unwind their request-scoped sessions. Every response must remain owned
    // by the correct cookie, and bodies must remain readable JSON.
    for (let burst = 0; burst < 3; burst++) {
      const sessions = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
        const response = await (index % 2 ? other : owner)("/api/v1/auth/session");
        expect(response.status).toBe(200);
        return response.json();
      }));
      for (const [index, session] of sessions.entries()) {
        expect(session.authenticated).toBe(true);
        if (index % 2) expect(session.tenant_id).not.toBe(identity.tenant_id);
        else expect(session.tenant_id).toBe(identity.tenant_id);
      }
    }
    // Browser reload uses /session, including its RLS-backed membership and
    // feature flags. Exercise separate invocations with unchanged cookies.
    for (let reload = 0; reload < 3; reload++) {
      const session = await owner("/api/v1/auth/session");
      expect(session.status).toBe(200);
      expect(await session.json()).toEqual({ authenticated: true, ...identity });
    }
    const denied = await owner("/api/v1/catalog/products", { method: "POST", csrf: false,
      body: { name: "CSRF must reject", price_amount: "18.50" } });
    expect(denied.status).toBe(403);
    const product = await owner("/api/v1/catalog/products", { method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { name: "Prueba Workers", price_amount: "18.50" } });
    expect(product.status).toBe(201);
    const item = await product.json();
    expect((await other(`/api/v1/catalog/products/${item.id}`, {
      method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { name: "No debe cambiar otro negocio" },
    })).status).toBe(404);
    const payload = { sales: [{ client_uuid: crypto.randomUUID(), order: {
      items: [{ product_id: item.id, quantity: 2 }],
      payments: [{ method: "cash", amount: "37.00", amount_tendered: "40.00" }],
    } }] };
    const first = await owner("/api/v1/sync/offline-sales", { method: "POST", body: payload });
    expect(first.status).toBe(200);
    const sale = (await first.json()).results[0];
    expect(sale.status).toBe("synced");
    expect(sale.order.total_amount).toBe("37.00");
    const replay = await owner("/api/v1/sync/offline-sales", { method: "POST", body: payload });
    expect(replay.status).toBe(200);
    expect((await replay.json()).results[0].order_id).toBe(sale.order_id);
    const overviewResponse = await owner("/api/v1/reports/dashboard?period=week");
    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.headers.get("Cache-Control")).toContain("no-store");
    const overview = await overviewResponse.json();
    expect(overview).toMatchObject({ active_catalog_count: 1, active_employee_count: 1,
      onboarding: { tenant_id: identity.tenant_id }, story: { summary: { net_sales: "37.00" } } });
    expect((await (await other("/api/v1/reports/dashboard")).json()).active_catalog_count).toBe(0);
    expect((await owner("/api/v1/auth/refresh", { method: "POST" })).status).toBe(200);
    expect((await owner("/api/v1/auth/me")).status).toBe(200);
    expect((await (await owner("/api/v1/auth/session")).json()).authenticated).toBe(true);
    expect((await owner("/api/v1/auth/logout", { method: "POST" })).status).toBe(204);
    expect((await owner("/api/v1/auth/me")).status).toBe(401);
    expect((await (await owner("/api/v1/auth/session")).json()).authenticated).toBe(false);
  });
});

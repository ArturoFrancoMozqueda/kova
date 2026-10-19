import { test } from "node:test";
import assert from "node:assert/strict";
import gateway, { coordinatorShard } from "../gateway.mjs";

test("dependent dashboard reads reuse the session coordinator with at most four lanes per cookie", () => {
  const groups = new Set();
  const chain = ["/api/v1/auth/session", "/api/v1/auth/refresh", "/api/v1/auth/logout",
    "/api/v1/settings/business-profile", "/api/v1/reports/business-story", "/api/v1/reports/dashboard",
    "/api/v1/reports/sales-summary", "/api/v1/reports/sales-by-hour"];
  const parallel = ["/api/v1/catalog/products", "/api/v1/inventory/stock",
    "/api/v1/inventory/low-stock", "/api/v1/onboarding/state", "/api/v1/employees",
    "/api/v1/shifts", "/api/v1/billing/subscription", "/api/v1/branches", "/api/v1/settings/receipt"];
  for (let index = 0; index < 128; index++) {
    const cookie = `synthetic-routing-cookie-${index}`;
    const critical = coordinatorShard(cookie, chain[0]);
    groups.add(critical);
    for (const path of chain) {
      assert.equal(coordinatorShard(cookie, path), critical);
      assert.equal(coordinatorShard(cookie, `${path}/`), critical);
    }
    const lanes = new Set([critical]);
    for (const path of parallel) {
      const shard = coordinatorShard(cookie, path);
      assert.ok(shard > critical && shard < critical + 4);
      assert.ok(shard >= 0 && shard < 16);
      lanes.add(shard);
    }
    assert.ok(lanes.size >= 3 && lanes.size <= 4);
  }
  assert.deepEqual([...groups].sort((a, b) => a - b), [0, 4, 8, 12]);
});

test("unknown scanner paths stay outside Python and the database", async () => {
  const env = { API: { getByName() { assert.fail("Unknown path entered Python"); } } };
  for (const path of ["/.env", "//.env.sample", "/web/.env", "/api/v10/auth", "/docs"]) {
    const response = await gateway.fetch(new Request(`https://api.test${path}`), env);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { detail: "Not Found" });
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
});

test("health, root and application routes retain their API handler", async () => {
  const env = { API: { getByName() { return { fetch: () => Response.json({ forwarded: true }) }; } } };
  for (const path of ["/", "/health", "/health/", "/health/db", "/health/db/",
    "/api/v1/auth/session", "/api/v1/billing/webhooks/stripe"]) {
    const response = await gateway.fetch(new Request(`https://api.test${path}`), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { forwarded: true });
  }
});

test("dashboard routes spread one cookie's reads while preserving private responses", async () => {
  const coordinators = new Set();
  const paths = ["/auth/session", "/settings/receipt", "/settings/business-profile",
    "/branches", "/billing/subscription", "/reports/business-story"];
  const env = { API: { getByName(name) {
    coordinators.add(name);
    return { async fetch(request) {
      assert.equal(request.headers.get("cookie"), "access_token=synthetic-test-cookie");
      assert.equal(request.headers.get("x-kova-client-ip"), "192.0.2.1");
      for (const header of ["fly-client-ip", "x-forwarded-for", "x-real-ip", "forwarded"]) {
        assert.equal(request.headers.has(header), false);
      }
      return Response.json({ path: new URL(request.url).pathname }, {
        headers: { "Set-Cookie": "csrf_token=synthetic-test; Secure; SameSite=Lax" },
      });
    } };
  } } };
  const responses = await Promise.all(paths.map(path => gateway.fetch(
    new Request(`https://api.test/api/v1${path}`, { headers: {
      Cookie: "access_token=synthetic-test-cookie", "CF-Connecting-IP": "192.0.2.1",
      "X-Forwarded-For": "spoofed", "Fly-Client-IP": "spoofed",
      "X-Real-IP": "spoofed", Forwarded: "spoofed",
    } }), env,
  )));
  assert.ok(coordinators.size >= 3, "dashboard reads must not share one serial queue");
  for (const [index, response] of responses.entries()) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).path, `/api/v1${paths[index]}`);
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie"), /csrf_token=synthetic-test/);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import gateway from "../gateway.mjs";

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

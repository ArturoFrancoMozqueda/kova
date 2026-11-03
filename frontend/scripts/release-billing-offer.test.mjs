import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPublicBillingOffer } from "./release-billing-offer.mjs";

const options = { frontendUrl: "https://candidate.vercel.app", backendUrl: "https://api.example",
  offer: "tiered", frontendBypassSecret: "synthetic-bypass" };
const catalog = () => ({ offer_revision: "offer-v1-4b30bf116e40f700f618fc38146bf3583f34311a8e87624ee57427f2446ce685", tiered_pricing_enabled: true,
  available_plans: Object.entries({ esencial: 39900, gestion: 69900 }).map(([code, amount]) => ({
    code, name: code === "esencial" ? "Esencial" : "Gestión", amount_minor_units: amount, currency: "MXN", interval: "month", tax_inclusive: true,
    features: ["pos", "inventory", "sales_reports", "public_catalog", ...(code === "gestion" ? ["purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"] : [])],
    limits: { branches: 1, product_image_bytes: code === "esencial" ? 250_000_000 : 1_073_741_824 },
  })) });

test("accepts both reviewed offers only when API and proxy agree; bypass stays on candidate", async () => {
  const requests = [];
  const fetch = async (url, init) => { requests.push([url, init]); return globalThis.Response.json(catalog()); };
  assert.deepEqual(await verifyPublicBillingOffer({ ...options, fetch }), { offer: "tiered", verified: true });
  assert.equal(requests[0][0], "https://api.example/api/v1/billing/plans");
  assert.equal(requests[0][1].headers["x-vercel-protection-bypass"], undefined);
  assert.equal(requests[1][1].headers["x-vercel-protection-bypass"], "synthetic-bypass");
  const standard = { ...catalog(), offer_revision: "offer-v1-5ecfbed72f3f6e39161e2114a05bbb80d642e889bca3f942e65b2253634ba139", tiered_pricing_enabled: false, available_plans: [{ code: "standard", name: "Standard Plan",
    features: catalog().available_plans[1].features, limits: { branches: null, product_image_bytes: null },
    amount_minor_units: 29900, currency: "MXN", interval: "month", tax_inclusive: null }] };
  assert.equal((await verifyPublicBillingOffer({ ...options, offer: "standard",
    fetch: async () => globalThis.Response.json(standard) })).verified, true);
});

for (const [name, mutate] of [
  ["old offer", body => { body.tiered_pricing_enabled = false; }],
  ["wrong amount", body => { body.available_plans[0].amount_minor_units = 29900; }],
  ["foreign currency", body => { body.available_plans[0].currency = "USD"; }],
  ["wrong period", body => { body.available_plans[0].interval = "year"; }],
  ["tax added", body => { body.available_plans[0].tax_inclusive = false; }],
  ["incorrect capabilities", body => { body.available_plans[1].features = []; }],
  ["incorrect image limit", body => { body.available_plans[0].limits.product_image_bytes = null; }],
  ["extra limit", body => { body.available_plans[0].limits.users = 1; }],
  ["incorrect name", body => { body.available_plans[0].name = "Standard"; }],
  ["unreviewed revision", body => { body.offer_revision = `offer-v1-${"c".repeat(64)}`; }],
  ["missing revision", body => { delete body.offer_revision; }],
  ["duplicate plan", body => { body.available_plans[1] = body.available_plans[0]; }],
  ["extra plan", body => { body.available_plans.push(body.available_plans[0]); }],
]) test(`blocks promotion for ${name} even if site health passed`, async () => {
  const body = catalog(); mutate(body);
  await assert.rejects(verifyPublicBillingOffer({ ...options,
    fetch: async () => globalThis.Response.json(body) }), /differs from the reviewed release/);
});

test("blocks a stale proxy, an unavailable offer and an unknown release choice", async () => {
  await assert.rejects(verifyPublicBillingOffer({ ...options, fetch: async url => {
    const body = catalog();
    if (url.startsWith(options.frontendUrl)) body.offer_revision = `offer-v1-${"b".repeat(64)}`;
    return globalThis.Response.json(body);
  } }), /differs/);
  await assert.rejects(verifyPublicBillingOffer({ ...options,
    fetch: async () => new globalThis.Response(null, { status: 503 }) }), /unavailable/);
  await assert.rejects(verifyPublicBillingOffer({ ...options, offer: "arbitrary" }), /Unknown/);
});

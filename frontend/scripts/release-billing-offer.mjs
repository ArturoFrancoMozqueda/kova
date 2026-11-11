// Change only with the reviewed commercial activation, independently of runtime IDs.
export const RELEASE_BILLING_OFFER = "tiered";
const core = ["pos", "inventory", "sales_reports", "public_catalog"];
const gestion = [...core, "purchasing", "advanced_reports", "loyalty", "customer_orders", "quotes"];
const plans = {
  standard: { name: "Standard Plan", amount: 29900, features: gestion, bytes: null, branches: null },
  esencial: { name: "Esencial", amount: 39900, features: core, bytes: 250_000_000, branches: 1 },
  gestion: { name: "Gestión", amount: 69900, features: gestion, bytes: 1_073_741_824, branches: 1 },
};
// Generated from public_offer in the reviewed backend, without provider IDs or credentials.
const revisions = {
  standard: "offer-v1-5ecfbed72f3f6e39161e2114a05bbb80d642e889bca3f942e65b2253634ba139",
  tiered: "offer-v1-4b30bf116e40f700f618fc38146bf3583f34311a8e87624ee57427f2446ce685",
};

export async function verifyPublicBillingOffer({ frontendUrl, backendUrl, offer,
  frontendBypassSecret, fetch = globalThis.fetch }) {
  if (!["standard", "tiered"].includes(offer)) throw new Error("Unknown release billing offer");
  const read = async (base, headers) => {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/billing/plans`, {
      headers: { "cache-control": "no-cache", ...headers }, cache: "no-store",
      signal: globalThis.AbortSignal.timeout(20_000), redirect: "error",
    });
    if (!response.ok) throw new Error("Public billing offer is unavailable");
    const body = await response.json();
    return verifyBillingOfferBody(body, offer);
  };
  const [direct, proxy] = await Promise.all([
    read(backendUrl, {}),
    read(frontendUrl, frontendBypassSecret ? { "x-vercel-protection-bypass": frontendBypassSecret } : {}),
  ]);
  if (direct !== proxy) throw new Error("API and frontend proxy disagree on the public billing offer");
  return { offer, verified: true };
}

// Shared by the public release gate and the private candidate controller.
// Return only the reviewed revision; never serialize arbitrary origin fields.
export function verifyBillingOfferBody(body, offer) {
  if (!["standard", "tiered"].includes(offer)) throw new Error("Unknown release billing offer");
  const expected = offer === "tiered" ? { esencial: plans.esencial, gestion: plans.gestion } : { standard: plans.standard };
  const available = body?.available_plans;
  if (!body || body.tiered_pricing_enabled !== (offer === "tiered")
      || body.offer_revision !== revisions[offer]
      || !Array.isArray(available) || available.length !== Object.keys(expected).length
      || new Set(available.map(plan => plan.code)).size !== available.length
      || available.some(plan => !Object.hasOwn(expected, plan.code)
        || plan.name !== expected[plan.code].name
        || plan.amount_minor_units !== expected[plan.code].amount
        || plan.currency !== "MXN" || plan.interval !== "month"
        || plan.tax_inclusive !== (offer === "tiered" ? true : null)
        || !Array.isArray(plan.features)
        || [...plan.features].sort().join(",") !== [...expected[plan.code].features].sort().join(",")
        || plan.limits?.product_image_bytes !== expected[plan.code].bytes
        || plan.limits?.branches !== expected[plan.code].branches
        || Object.keys(plan.limits).sort().join(",") !== "branches,product_image_bytes")) {
    throw new Error("Public billing offer differs from the reviewed release");
  }
  return body.offer_revision;
}

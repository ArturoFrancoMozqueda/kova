import { normalizeNativeHandoffDiff } from "./native-handoff.mjs";
import { normalizeNativeGatewayDiff } from "./native-gateway-transition.mjs";

// Public identifiers only. Credentials, URLs and rollout flags never enter this map.
export const STRIPE_RUNTIME_ID_RULES = Object.freeze({
  STRIPE_ESENCIAL_PRICE_ID: "price_",
  STRIPE_GESTION_PRICE_ID: "price_",
  STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_",
  STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_",
});

export function stripeRuntimeIds(environment) {
  const result = {};
  for (const [name, prefix] of Object.entries(STRIPE_RUNTIME_ID_RULES)) {
    const value = environment[name];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || value.length > 255
        || !new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(value)) {
      throw new Error(`Invalid public Stripe identifier: ${name}`);
    }
    result[name] = value;
  }
  const count = Object.keys(result).length;
  if (count !== 0 && count !== 4) throw new Error("Configure all four public Stripe identifiers together");
  if (count && result.STRIPE_ESENCIAL_PRICE_ID === result.STRIPE_GESTION_PRICE_ID) {
    throw new Error("Commercial Price IDs must be distinct");
  }
  return result;
}

// Embedded verbatim in the pinned CLI patch, so this function must be self-contained.
// Its result is comparison metadata only; neither deployment input is changed.
export function normalizeStripeRuntimeIdDiff(remote, local, environment, rules) {
  const copy = structuredClone(remote);
  const names = Object.keys(rules);
  const desired = names.filter(name => Object.hasOwn(local.vars ?? {}, name));
  const slots = { blue: "kova-api-blue", green: "kova-api-green" };
  const slot = Object.keys(slots).find(key => slots[key] === local.name);
  if (!desired.length || (!slot && !["kova-backend", "kova-backend-jobs"].includes(local.name))) return copy;
  if (slot && environment.KOVA_NATIVE_TARGET_SLOT !== slot) {
    throw new Error("Unverified native slot configuration");
  }
  if (desired.length !== 4) throw new Error("Incomplete public Stripe configuration in release artifact");
  const previous = slot ? environment.KOVA_NATIVE_TARGET_PREVIOUS_SHA : environment.KOVA_NATIVE_PREVIOUS_SHA;
  const target = environment.KOVA_NATIVE_DEPLOY_SHA;
  if (!/^[a-f0-9]{40}$/i.test(previous ?? "") || !/^[a-f0-9]{40}$/i.test(target ?? "")
      || (remote.vars?.KOVA_BUILD_SHA !== previous
        && !((local.name === "kova-backend" || slot) && remote.vars?.KOVA_BUILD_SHA === target
          && names.every(name => remote.vars?.[name] === local.vars[name])))
      || local.vars?.KOVA_BUILD_SHA !== target
      || (remote.name !== undefined && remote.name !== local.name)) {
    throw new Error("Public Stripe configuration requires the captured release transition");
  }
  for (const [name, prefix] of Object.entries(rules)) {
    const value = local.vars[name];
    const valid = candidate => typeof candidate === "string" && candidate.length <= 255
      && new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(candidate);
    if (!valid(value) || value !== environment[name]
        || (Object.hasOwn(remote.vars ?? {}, name) && !valid(remote.vars[name]))) {
      throw new Error(`Unverified public Stripe configuration: ${name}`);
    }
  }
  if (local.vars.STRIPE_ESENCIAL_PRICE_ID === local.vars.STRIPE_GESTION_PRICE_ID) {
    throw new Error("Commercial Price IDs must be distinct");
  }
  // Do not copy any other text binding, secret, resource descriptor or flag.
  for (const name of names) copy.vars[name] = local.vars[name];
  copy.vars.KOVA_BUILD_SHA = target;
  return copy;
}

export function commercialComparatorPrefix({ native = false } = {}) {
  // Validate handoff while remote still has the captured SHA, before the
  // existing commercial comparator normalizes its build identity.
  const handoff = native ? `e=(${normalizeNativeHandoffDiff.toString()})(e,n,process.env);` : "";
  const normalize = `(${normalizeStripeRuntimeIdDiff.toString()})(e,n,process.env,${JSON.stringify(STRIPE_RUNTIME_ID_RULES)})`;
  const gateway = `e=(${normalizeNativeGatewayDiff.toString()})(e,n,process.env);`;
  const ownNamespaces = native
    ? "for(let r of e.durable_objects?.bindings??[])if(r.script_name===void 0&&n.durable_objects?.bindings?.some(t=>t.name===r.name&&t.class_name===r.class_name&&t.script_name===n.name))r.script_name=n.name;"
    : "";
  const previousIdentity = native
    ? "let i=process.env.KOVA_NATIVE_PREVIOUS_SHA,a=process.env.KOVA_NATIVE_DEPLOY_SHA;if(n.name===`kova-backend`&&/^[a-f0-9]{40}$/i.test(i??``)&&/^[a-f0-9]{40}$/i.test(a??``)&&e.vars?.KOVA_BUILD_SHA===i&&n.vars?.KOVA_BUILD_SHA===a)e.vars.KOVA_BUILD_SHA=a;"
    : "";
  return `function xE(e,t){let n=SE(t);${handoff}${gateway}e=${normalize};${ownNamespaces}${previousIdentity}let r=_E(DE(e,n),n);`;
}

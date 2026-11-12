// Embedded in the pinned CLI comparator. Validate the captured routing
// transition before normalizing ONLY reviewed API routing or the private slot
// settings binding. Other fields retain the upstream comparator's rules.
export function normalizeNativeGatewayDiff(remote, local, environment) {
  const copy = structuredClone(remote);
  const slotWorkers = { blue: "kova-api-blue", green: "kova-api-green", recovery: "kova-api-recovery" };
  const slot = Object.keys(slotWorkers).find(key => slotWorkers[key] === local.name);
  if (slot) {
    const desired = (local.services ?? []).filter(item => item.binding === "SETTINGS");
    if (desired.length !== 1 || desired[0].service !== "kova-native-signup-settings") return copy;
    const previous = environment.KOVA_NATIVE_TARGET_PREVIOUS_SHA;
    const target = environment.KOVA_NATIVE_DEPLOY_SHA;
    const services = (remote.services ?? []).filter(item => item.binding === "SETTINGS");
    const known = (item, worker, entrypoint) => item?.binding === "SETTINGS"
      && item.service === worker && item.entrypoint === entrypoint && item.environment === undefined
      && Object.keys(item).every(key => ["binding", "service", "entrypoint", "environment"].includes(key));
    const fail = () => { throw new Error("Unverified private slot settings transition"); };
    if (environment.KOVA_NATIVE_TARGET_SLOT !== slot
        || !/^[a-f0-9]{40}$/i.test(previous ?? "") || !/^[a-f0-9]{40}$/i.test(target ?? "")
        || ![previous, target].includes(remote.vars?.KOVA_BUILD_SHA)
        || local.vars?.KOVA_BUILD_SHA !== target || (remote.name !== undefined && remote.name !== local.name)
        || services.length !== 1 || !known(desired[0], "kova-native-signup-settings", "SignupSettings")
        || !(known(services[0], "kova-backend", "NativeSettings")
          || known(services[0], "kova-native-signup-settings", "SignupSettings"))) fail();
    copy.services = copy.services.map(item => item.binding === "SETTINGS" ? structuredClone(desired[0]) : item);
    // Recovery is a new identity. Its build may advance only while every
    // public commercial identifier remains identical to the captured values.
    // Blue/green retain their existing commercial comparator below this one.
    if (slot === "recovery") {
      const rules = { STRIPE_ESENCIAL_PRICE_ID: "price_", STRIPE_GESTION_PRICE_ID: "price_",
        STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_", STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_" };
      for (const [name, prefix] of Object.entries(rules)) {
        const value = local.vars[name];
        if (typeof value !== "string" || value.length > 255 || !new RegExp(`^${prefix}[A-Za-z0-9]+$`).test(value)
            || value !== remote.vars?.[name] || value !== environment[name]) fail();
      }
      if (local.vars.STRIPE_ESENCIAL_PRICE_ID === local.vars.STRIPE_GESTION_PRICE_ID) fail();
      copy.vars.KOVA_BUILD_SHA = target;
    }
    return copy;
  }
  if (local.name !== "kova-backend-gateway"
      || local.vars?.KOVA_NATIVE_ACTIVE_SLOT === undefined) return copy;
  const workers = { legacy: "kova-backend", blue: "kova-api-blue", green: "kova-api-green",
    recovery: "kova-api-recovery" };
  const previous = environment.KOVA_NATIVE_PREVIOUS_SLOT;
  const active = environment.KOVA_NATIVE_ACTIVE_SLOT;
  const candidate = environment.KOVA_NATIVE_CANDIDATE_SLOT;
  const phase = environment.KOVA_NATIVE_ROUTING_PHASE;
  const valid = slot => typeof slot === "string" && Object.hasOwn(workers, slot);
  const fail = () => { throw new Error("Unverified native gateway routing transition"); };
  if (!valid(previous) || !valid(active) || !valid(candidate) || active === candidate
      || !["stage", "promote"].includes(phase)
      || local.vars.KOVA_NATIVE_ACTIVE_SLOT !== active || local.vars.KOVA_NATIVE_CANDIDATE_SLOT !== candidate
      || (phase === "stage" ? active !== previous : candidate !== previous)) fail();
  const remoteActive = remote.vars?.KOVA_NATIVE_ACTIVE_SLOT ?? "legacy";
  const remoteCandidate = remote.vars?.KOVA_NATIVE_CANDIDATE_SLOT;
  if (!valid(remoteActive) || (remoteCandidate !== undefined
      && (!valid(remoteCandidate) || remoteActive === remoteCandidate))
      || (phase === "stage" && remoteActive !== previous)
      || (phase === "promote" && (remoteActive !== previous && remoteActive !== active))) fail();
  if (phase === "promote" && remoteCandidate !== (remoteActive === previous ? active : previous)) fail();
  const binding = (config, name) => {
    const matches = (config.durable_objects?.bindings ?? []).filter(item => item.name === name);
    if (matches.length > 1) fail();
    return matches[0];
  };
  const matches = (value, slot) => value && value.class_name === "KovaApi"
    && value.script_name === workers[slot] && value.environment === undefined;
  if (!matches(binding(local, "API"), active) || !matches(binding(local, "CANDIDATE_API"), candidate)
      || !matches(binding(remote, "API"), remoteActive)
      || (remoteCandidate === undefined ? binding(remote, "CANDIDATE_API") !== undefined
        : !matches(binding(remote, "CANDIDATE_API"), remoteCandidate))) fail();
  copy.vars ??= {};
  copy.vars.KOVA_NATIVE_ACTIVE_SLOT = active;
  copy.vars.KOVA_NATIVE_CANDIDATE_SLOT = candidate;
  copy.durable_objects.bindings = copy.durable_objects.bindings.filter(item =>
    item.name !== "API" && item.name !== "CANDIDATE_API");
  copy.durable_objects.bindings.push(structuredClone(binding(local, "API")),
    structuredClone(binding(local, "CANDIDATE_API")));
  return copy;
}

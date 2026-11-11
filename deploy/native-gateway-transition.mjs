// Embedded in the pinned CLI comparator. Validate the captured routing
// transition before normalizing ONLY the two reviewed API bindings/slot vars.
// Credentials, domains, limits, flags and every other resource remain strict.
export function normalizeNativeGatewayDiff(remote, local, environment) {
  const copy = structuredClone(remote);
  if (local.name !== "kova-backend-gateway"
      || local.vars?.KOVA_NATIVE_ACTIVE_SLOT === undefined) return copy;
  const workers = { legacy: "kova-backend", blue: "kova-api-blue", green: "kova-api-green" };
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

// Public release metadata only. It never changes the environment of a running
// process or substitutes the image's immutable release / boot identity.
export const NATIVE_HANDOFF_MAX_MS = 30 * 60 * 1000;

export function nativeHandoff(input, targetSha, now = Date.now()) {
  if (typeof input !== "string" || !/^[a-f0-9]{40}$/i.test(targetSha ?? "")) return null;
  let value;
  try { value = JSON.parse(input); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== 2 || !Object.hasOwn(value, "previousSha")
      || !Object.hasOwn(value, "expiresAt")
      || !/^[a-f0-9]{40}$/i.test(value.previousSha ?? "") || value.previousSha === targetSha
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now
      || value.expiresAt > now + NATIVE_HANDOFF_MAX_MS) return null;
  return value;
}

// Self-contained: embedded in the pinned cf comparator. Normalize only this
// reviewed, short-lived binding across the captured full release transition.
export function normalizeNativeHandoffDiff(remote, local, environment, now = Date.now()) {
  const copy = structuredClone(remote);
  const previous = environment.KOVA_NATIVE_PREVIOUS_SHA, target = environment.KOVA_NATIVE_DEPLOY_SHA;
  if (local.name !== "kova-backend") return copy;
  if (!Object.hasOwn(local.vars ?? {}, "KOVA_NATIVE_HANDOFF")) {
    // An explicit same-build publication needs no overlap. Remove this public
    // lease only for that captured identity; no other binding is normalized.
    if (/^[a-f0-9]{40}$/i.test(target ?? "") && previous === target
        && remote.vars?.KOVA_BUILD_SHA === target && local.vars?.KOVA_BUILD_SHA === target
        && (remote.name === undefined || remote.name === local.name)
        && environment.KOVA_NATIVE_HANDOFF === undefined) delete copy.vars.KOVA_NATIVE_HANDOFF;
    return copy;
  }
  let handoff;
  try { handoff = JSON.parse(local.vars.KOVA_NATIVE_HANDOFF); } catch { /* fail below */ }
  if (!/^[a-f0-9]{40}$/i.test(previous ?? "") || !/^[a-f0-9]{40}$/i.test(target ?? "")
      || previous === target || remote.vars?.KOVA_BUILD_SHA !== previous
      || local.vars?.KOVA_BUILD_SHA !== target
      || (remote.name !== undefined && remote.name !== local.name)
      || local.vars.KOVA_NATIVE_HANDOFF !== environment.KOVA_NATIVE_HANDOFF
      || !handoff || typeof handoff !== "object" || Array.isArray(handoff)
      || Object.keys(handoff).length !== 2 || handoff.previousSha !== previous
      || !Number.isSafeInteger(handoff.expiresAt) || handoff.expiresAt <= now
      || handoff.expiresAt > now + 30 * 60 * 1000) {
    throw new Error("Native handoff requires a bounded captured release transition");
  }
  copy.vars.KOVA_NATIVE_HANDOFF = local.vars.KOVA_NATIVE_HANDOFF;
  return copy;
}

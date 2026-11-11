import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { nextSlot, slotWorker, SLOT_APPLICATIONS } from "./native-slots.mjs";
import { exactResourceType } from "./cloudflare-container-provider.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const directory = path.join(root, "deploy/cloudflare-backend");
const nativeDirectory = path.join(root, "deploy/cloudflare-native");
const shaPattern = /^[a-f0-9]{40}$/i;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const namespace = /^[a-f0-9]{32}$/i;
const imagePattern = slot => new RegExp(`^registry\\.cloudflare\\.com/47d850c847503be3597dc7165cfea177/kova-api-${slot}(?:@sha256:[a-f0-9]{64}|:[a-f0-9]{8,64})$`);
const coreFiles = ["deploy/cloudflare-native/entry.mjs", "deploy/cloudflare-native/runtime-settings.mjs",
  "deploy/cloudflare-native/private-settings-entry.mjs",
  "deploy/cloudflare-native/lifecycle.mjs",
  "deploy/cloudflare-native/policy.mjs", "deploy/cloudflare-native/rate-limit.mjs",
  "deploy/cloudflare-native/settings-keys.json", "deploy/cloudflare-native/cloudflare.config.ts",
  "deploy/cloudflare-native/package.json", "deploy/cloudflare-native/package-lock.json",
  "deploy/public-images.mjs", "deploy/native-handoff.mjs",
  "deploy/stripe-runtime-ids.mjs", "deploy/native-gateway-transition.mjs"];
const readinessHeaders = { "Cache-Control": "no-cache", "User-Agent": "Mozilla/5.0 KovaResidentAcceptance/1.0" };
async function readinessJson(response) {
  try { return await response.json(); }
  catch { throw new Error("Malformed native readiness contract"); }
}

export function validateNativeSlots(input) {
  if (!input || Array.isArray(input) || Object.keys(input).sort().join(",") !== "activeProcessId,activeReleaseSha,activeSlot,coreSourceSha,slots,version"
      || input.version !== 1 || !shaPattern.test(input.coreSourceSha ?? "")
      || !shaPattern.test(input.activeReleaseSha ?? "") || !/^[a-f0-9]{32}$/.test(input.activeProcessId ?? "")
      || !input.slots || Object.keys(input.slots).sort().join(",") !== "blue,green") {
    throw new Error("Invalid native slot rollback artifact");
  }
  slotWorker(input.activeSlot);
  const slots = {};
  for (const slot of ["blue", "green"]) {
    const record = input.slots[slot];
    if (record === null) { slots[slot] = null; continue; }
    if (!record || Array.isArray(record)
        || Object.keys(record).sort().join(",") !== "applicationId,image,namespaceId,releaseSha,workerVersion"
        || !uuid.test(record.workerVersion ?? "")
        || (record.applicationId === null ? record.image !== null
          : !uuid.test(record.applicationId ?? "") || !imagePattern(slot).test(record.image ?? ""))
        || !namespace.test(record.namespaceId ?? "")
        || !shaPattern.test(record.releaseSha ?? "")) {
      throw new Error("Invalid native slot identity");
    }
    slots[slot] = { workerVersion: record.workerVersion, applicationId: record.applicationId,
      namespaceId: record.namespaceId, image: record.image, releaseSha: record.releaseSha };
  }
  if (input.activeSlot !== "legacy" && (slots[input.activeSlot] === null
      || slots[input.activeSlot].applicationId === null
      || slots[input.activeSlot].releaseSha !== input.activeReleaseSha)) {
    throw new Error("Serving API slot has no captured version");
  }
  return { version: 1, activeSlot: input.activeSlot, coreSourceSha: input.coreSourceSha, slots,
    activeReleaseSha: input.activeReleaseSha, activeProcessId: input.activeProcessId };
}

export function nativeBlueGreenProvider({ run, env, fetcher = globalThis.fetch,
  wait = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms)), now = Date.now,
  onCandidateReady = () => {},
  git = args => execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" }) }) {
  const cf = async (args, capture = false, commandEnv = env, native = false) => {
    const base = native ? nativeDirectory : directory;
    return run(process.execPath, [path.join(base, "node_modules/cf/bin/cf"), ...args],
      { cwd: base, env: commandEnv, capture, label: "Cloudflare isolated API publication" });
  };
  const json = async args => {
    try { return JSON.parse(await cf(args, true)); }
    catch { throw new Error("Cannot inspect the exact native publication state"); }
  };
  const deployedVersion = async worker => {
    const result = await json(["workers", "deployments", "list", "--script-name", worker]);
    const versions = result.deployments?.[0]?.versions;
    if (versions?.length !== 1 || versions[0].percentage !== 100 || !uuid.test(versions[0].version_id ?? "")) {
      throw new Error("Native publication requires one exact serving Worker version");
    }
    return versions[0].version_id;
  };
  const metadata = async worker => {
    const version = await deployedVersion(worker);
    const record = await json(["workers", "versions", "get", version, "--worker-id", worker]);
    if (record.id !== version || !record.env || typeof record.env !== "object") {
      throw new Error("Invalid native Worker metadata");
    }
    // Callers project only reviewed public identity/configuration. Never
    // serialize the source, sealed bindings or arbitrary environment values.
    return record;
  };
  const text = (record, name) => record.env[name]?.type === "plain_text" ? record.env[name].text : undefined;
  const activeSlot = gateway => {
    const active = text(gateway, "KOVA_NATIVE_ACTIVE_SLOT") ?? "legacy";
    const binding = gateway.env.API;
    const worker = binding?.script_name ?? "kova-backend-gateway";
    if (binding?.type !== "durable_object_namespace" || binding.class_name !== "KovaApi"
        || worker !== slotWorker(active) || binding.environment !== undefined) {
      throw new Error("Public gateway does not match its captured native slot");
    }
    return active;
  };
  const applications = async () => {
    const result = await json(["containers", "applications", "list"]);
    if (!Array.isArray(result)) throw new Error("Invalid native application inventory");
    return result;
  };
  const workers = async () => {
    const names = new Set();
    for (let page = 1; page <= 10; page++) {
      const result = await json(["workers", "list", "--page", String(page), "--per-page", "100"]);
      if (!Array.isArray(result)) throw new Error("Invalid native Worker inventory");
      for (const record of result) if (typeof record.name === "string") names.add(record.name);
      if (result.length < 100) return names;
    }
    throw new Error("Cannot prove complete native Worker inventory");
  };
  const slotRecord = async (slot, inventory, { allowAbsent = false } = {}) => {
    const worker = await metadata(slotWorker(slot));
    const binding = worker.env.API;
    if (binding?.type !== "durable_object_namespace" || binding.class_name !== "KovaApi"
        || !namespace.test(binding.namespace_id ?? "")
        || (binding.script_name !== undefined && binding.script_name !== slotWorker(slot))) {
      throw new Error("Native slot namespace ownership mismatch");
    }
    const matches = inventory.filter(record => record.name === SLOT_APPLICATIONS[slot]);
    if (matches.length === 0 && allowAbsent) {
      return { workerVersion: worker.id, namespaceId: binding.namespace_id,
        applicationId: null, image: null, releaseSha: text(worker, "KOVA_BUILD_SHA") };
    }
    if (matches.length !== 1) throw new Error("Native slot application is absent or ambiguous");
    const app = await json(["containers", "applications", "get", matches[0].id]);
    const config = app.configuration;
    if (app.id !== matches[0].id || app.name !== SLOT_APPLICATIONS[slot]
        || app.scheduling_policy !== "default" || app.max_instances !== 1
        || app.durable_objects?.namespace_id !== binding.namespace_id
        || !imagePattern(slot).test(config?.image ?? "")
        || exactResourceType(config) !== "basic") throw new Error("Unapproved native slot application configuration");
    return { workerVersion: worker.id, applicationId: app.id,
      namespaceId: binding.namespace_id, image: config.image, releaseSha: text(worker, "KOVA_BUILD_SHA") };
  };
  const health = async (candidate = false) => {
    const response = await fetcher(`https://api.kovasuite.com/health${candidate ? "/candidate" : ""}`, {
      headers: readinessHeaders, signal: globalThis.AbortSignal.timeout(15_000), redirect: "error",
    });
    if (!response.ok) { await response.body?.cancel(); return null; }
    const body = await readinessJson(response);
    if (body?.status !== "ok" || !shaPattern.test(body.release_sha ?? "")
        || !/^[a-f0-9]{32}$/.test(response.headers.get("x-kova-process-id") ?? "")
        || response.headers.get("x-kova-boot-controller-sha") !== body.release_sha
        || response.headers.get("x-kova-controller-sha") !== body.release_sha) {
      throw new Error("Unexpected native runtime identity");
    }
    return { sha: body.release_sha, process: response.headers.get("x-kova-process-id"),
      replaceable: body.replaceable, db: body.db, offerVerified: body.offer_verified };
  };
  const buildGateway = async commandEnv => {
    await run(process.execPath, [path.join(directory, "build-gateway.mjs")],
      { cwd: directory, env: commandEnv, label: "Build exact native gateway routing" });
    await cf(["deploy", "--prebuilt", "--worker", "kova-backend-gateway", "--dry-run"], false, commandEnv);
    await cf(["deploy", "--prebuilt", "--worker", "kova-backend-gateway"], false, commandEnv);
  };
  return {
    async prepare(artifact) {
      const sourceSha = env.GITHUB_SHA ?? process.env.GITHUB_SHA;
      if (!shaPattern.test(sourceSha ?? "")) throw new Error("Native preparation requires the reviewed source SHA");
      if (git(["rev-parse", "HEAD"]).trim() !== sourceSha) {
        throw new Error("Native preparation source does not match the reviewed SHA");
      }
      try { git(["diff", "--quiet", "HEAD", "--"]); }
      catch { throw new Error("Native preparation requires an unchanged reviewed source tree"); }
      const core = await metadata("kova-backend");
      if (core.exports?.NativeSettings?.type === "worker") {
        const source = text(core, "KOVA_NATIVE_CORE_SOURCE_SHA");
        if (!shaPattern.test(source ?? "")) throw new Error("Native settings source identity missing");
        try { git(["diff", "--quiet", source, sourceSha, "--", ...coreFiles]); }
        catch { throw new Error("Shared native settings/rate-limit changes require a separate control-plane migration"); }
        return;
      }
      const baseline = await health();
      if (baseline?.sha !== artifact.releaseSha || !artifact.cloudflareNativeContainer?.image) {
        throw new Error("Native bootstrap requires the verified serving legacy image");
      }
      if (activeSlot(await metadata("kova-backend-gateway")) !== "legacy"
          || text(core, "KOVA_BUILD_SHA") !== artifact.releaseSha) {
        throw new Error("Missing shared settings holder outside the reviewed legacy bootstrap");
      }
      const ids = {};
      for (const name of ["STRIPE_ESENCIAL_PRICE_ID", "STRIPE_GESTION_PRICE_ID",
        "STRIPE_STANDARD_PORTAL_CONFIGURATION_ID", "STRIPE_TIERED_PORTAL_CONFIGURATION_ID"]) {
        const value = text(core, name);
        if (!value) throw new Error("Cannot preserve the legacy public offer");
        ids[name] = value;
      }
      const bootstrapEnv = { ...env, ...ids, KOVA_BUILD_SHA: artifact.releaseSha,
        KOVA_NATIVE_PREVIOUS_SHA: artifact.releaseSha, KOVA_NATIVE_DEPLOY_SHA: artifact.releaseSha,
        KOVA_NATIVE_CORE_SOURCE_SHA: sourceSha,
        KOVA_NATIVE_CORE_IMAGE: artifact.cloudflareNativeContainer.image };
      for (const [binding, variable] of [["DB_APP", "KOVA_HYPERDRIVE_APP_ID"],
        ["DB_PRIVILEGED", "KOVA_HYPERDRIVE_PRIVILEGED_ID"]]) {
        const resource = core.env[binding];
        if (resource?.type !== "hyperdrive" || !/^[a-f0-9]{32}$/i.test(resource.id ?? "")) {
          throw new Error("Cannot preserve the captured legacy database binding");
        }
        bootstrapEnv[variable] = resource.id;
      }
      delete bootstrapEnv.KOVA_NATIVE_HANDOFF;
      delete bootstrapEnv.KOVA_NATIVE_TARGET_SLOT;
      delete bootstrapEnv.KOVA_NATIVE_ACTIVE_SLOT;
      delete bootstrapEnv.KOVA_NATIVE_CANDIDATE_SLOT;
      // Add only a private routing-status entrypoint to the unchanged legacy
      // gateway before binding the settings holder to it. Neither adds a DO
      // namespace, changes its image or crosses a rollback migration barrier.
      await buildGateway(bootstrapEnv);
      await run(process.execPath, [path.join(nativeDirectory, "build.mjs")], {
        cwd: nativeDirectory, env: bootstrapEnv, label: "Bootstrap private settings with the unchanged legacy image",
      });
      const args = ["deploy", "--prebuilt", "--worker", "kova-backend", "--containers-rollout", "none"];
      await cf([...args, "--dry-run"], false, bootstrapEnv, true);
      await cf(args, false, bootstrapEnv, true);
      const deadline = now() + 60_000;
      let installed = false;
      while (now() < deadline) {
        const current = await metadata("kova-backend");
        if (current.exports?.NativeSettings?.type === "worker"
            && text(current, "KOVA_NATIVE_CORE_SOURCE_SHA") === sourceSha) { installed = true; break; }
        if (text(current, "KOVA_BUILD_SHA") !== artifact.releaseSha) {
          throw new Error("Legacy API metadata changed during private settings bootstrap");
        }
        await wait(1000);
      }
      if (!installed) throw new Error("Private settings bootstrap did not propagate");
      const after = await health();
      if (after?.sha !== baseline.sha || after?.process !== baseline.process) {
        throw new Error("Legacy process changed during private settings bootstrap");
      }
    },
    async capture(expectedSha) {
      const core = await metadata("kova-backend");
      const gateway = await metadata("kova-backend-gateway");
      const inventory = await applications();
      const names = await workers();
      const active = activeSlot(gateway);
      const slots = {};
      for (const slot of ["blue", "green"]) {
        slots[slot] = names.has(slotWorker(slot))
          ? await slotRecord(slot, inventory, { allowAbsent: slot !== active }) : null;
      }
      const serving = await health();
      if (serving?.sha !== expectedSha) throw new Error("Serving API changed during slot capture");
      return validateNativeSlots({ version: 1, activeSlot: active,
        coreSourceSha: text(core, "KOVA_NATIVE_CORE_SOURCE_SHA"), slots,
        activeReleaseSha: serving.sha, activeProcessId: serving.process });
    },
    async publish(sha, previousSha, rawSnapshot) {
      const snapshot = validateNativeSlots(rawSnapshot);
      const target = nextSlot(snapshot.activeSlot);
      const baseline = await health();
      if (baseline?.sha !== previousSha || baseline.process !== snapshot.activeProcessId
          || previousSha !== snapshot.activeReleaseSha
          || activeSlot(await metadata("kova-backend-gateway")) !== snapshot.activeSlot) {
        throw new Error("Serving API changed before native staging");
      }
      const stagingEnv = { ...env, KOVA_BUILD_SHA: sha, KOVA_NATIVE_TARGET_SLOT: target,
        KOVA_NATIVE_PREVIOUS_SLOT: snapshot.activeSlot,
        KOVA_NATIVE_ACTIVE_SLOT: snapshot.activeSlot, KOVA_NATIVE_CANDIDATE_SLOT: target,
        KOVA_NATIVE_DEPLOY_SHA: sha, KOVA_NATIVE_PREVIOUS_SHA: previousSha,
        KOVA_NATIVE_ROUTING_PHASE: "stage",
        KOVA_NATIVE_TARGET_PREVIOUS_SHA: snapshot.slots[target]?.releaseSha ?? sha };
      if (snapshot.slots[target] !== null && snapshot.slots[target].applicationId !== null) {
        // The candidate binding from the prior accepted gateway points at the
        // old slot. Wait for its persisted lease and complete response bodies
        // BEFORE changing its Worker, image or startup configuration.
        await buildGateway(stagingEnv);
        const deadline = now() + 900_000;
        let drained = false;
        while (now() < deadline) {
          const response = await fetcher("https://api.kovasuite.com/health/candidate/drain", {
            headers: readinessHeaders, signal: globalThis.AbortSignal.timeout(15_000), redirect: "error",
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("Cannot prove inactive API drain state");
          }
          const probe = await readinessJson(response);
          if (!probe || probe.release_sha !== snapshot.slots[target].releaseSha
              || typeof probe.replaceable !== "boolean") {
            throw new Error("Inactive slot returned an uncaptured release identity");
          }
          if (probe?.replaceable === true) { drained = true; break; }
          await wait(1000);
        }
        if (!drained) throw new Error("Inactive API did not finish draining; serving API preserved");
      }
      const artifactEnv = { ...stagingEnv };
      delete artifactEnv.SUPABASE_DB_URL;
      delete artifactEnv.KOVA_NATIVE_CORE_IMAGE;
      await run(process.execPath, [path.join(nativeDirectory, "build.mjs")], {
        cwd: nativeDirectory, env: artifactEnv, label: "Build independent inactive API image",
      });
      const args = ["deploy", "--prebuilt", "--worker", slotWorker(target), "--tag", sha.slice(0, 12)];
      await cf([...args, "--dry-run"], false, stagingEnv, true);
      await cf(args, false, stagingEnv, true);
      await buildGateway(stagingEnv);
      const deadline = now() + 600_000;
      let readyProcess;
      while (now() < deadline) {
        let probe;
        try { probe = await health(true); } catch (error) {
          if (error.name !== "TimeoutError" && error.name !== "AbortError") throw error;
        }
        if (probe && probe.sha !== sha && probe.sha !== snapshot.slots[target]?.releaseSha) {
          throw new Error("Candidate returned an uncaptured release identity");
        }
        if (probe?.sha === sha && probe.db === "reachable" && probe.offerVerified === true) {
          readyProcess = probe.process; break;
        }
        await wait(1000);
      }
      if (!readyProcess) throw new Error("Candidate API failed readiness; serving API preserved");
      const beforePromotion = await health();
      if (beforePromotion?.sha !== previousSha || beforePromotion?.process !== baseline.process) {
        throw new Error("Serving API changed while its independent replacement warmed");
      }
      const publication = { processId: readyProcess, previousProcessId: baseline.process, slot: target };
      onCandidateReady(publication);
      await buildGateway({ ...stagingEnv, KOVA_NATIVE_ACTIVE_SLOT: target,
        KOVA_NATIVE_CANDIDATE_SLOT: snapshot.activeSlot, KOVA_NATIVE_ROUTING_PHASE: "promote" });
      return publication;
    },
    async restore(versions, rawSnapshot) {
      const snapshot = validateNativeSlots(rawSnapshot);
      if (await deployedVersion("kova-backend") !== versions["kova-backend"]) {
        throw new Error("Captured native settings/controller changed; recovery must not guess");
      }
      if (snapshot.activeSlot !== "legacy") {
        const current = await slotRecord(snapshot.activeSlot, await applications());
        if (JSON.stringify(current) !== JSON.stringify(snapshot.slots[snapshot.activeSlot])) {
          throw new Error("Captured serving slot changed; recovery must not replace an unknown image");
        }
      }
      const version = versions["kova-backend-gateway"];
      if (!uuid.test(version ?? "")) throw new Error("Invalid exact native gateway rollback version");
      let departing;
      try { departing = await health(); } catch { /* Recovery must still restore the verified old route. */ }
      const currentGateway = await metadata("kova-backend-gateway");
      const currentActive = activeSlot(currentGateway);
      let restoredProcess;
      if (currentActive === snapshot.activeSlot && departing?.sha === snapshot.activeReleaseSha) {
        restoredProcess = departing.process;
      } else {
        const useCandidate = currentActive !== snapshot.activeSlot;
        if (useCandidate && text(currentGateway, "KOVA_NATIVE_CANDIDATE_SLOT") !== snapshot.activeSlot) {
          await buildGateway({ ...env, KOVA_NATIVE_PREVIOUS_SLOT: currentActive,
            KOVA_NATIVE_ACTIVE_SLOT: currentActive, KOVA_NATIVE_CANDIDATE_SLOT: snapshot.activeSlot,
            KOVA_NATIVE_ROUTING_PHASE: "stage" });
        }
        // A parked previous process is warmed while the current route still
        // serves. Never point public requests at a cold rollback target.
        const deadline = now() + 600_000;
        while (now() < deadline) {
          let probe;
          try { probe = await health(useCandidate); } catch (error) {
            if (error.name !== "TimeoutError" && error.name !== "AbortError") throw error;
          }
          if (probe && probe.sha !== snapshot.activeReleaseSha) {
            throw new Error("Rollback candidate returned a foreign release");
          }
          if (probe?.sha === snapshot.activeReleaseSha && (!useCandidate || probe.db === "reachable")) {
            restoredProcess = probe.process; break;
          }
          await wait(1000);
        }
        if (!restoredProcess) throw new Error("Previous API did not warm; current route preserved");
      }
      await cf(["workers", "deployments", "create", "--script-name", "kova-backend-gateway",
        "--strategy", "percentage", "--versions", JSON.stringify([{ version_id: version, percentage: 100 }])]);
      // The failed inactive Worker remains isolated so in-flight responses
      // can finish. Neither captured serving image nor controller is restarted.
      return { processId: restoredProcess, previousProcessId: departing?.process };
    },
  };
}

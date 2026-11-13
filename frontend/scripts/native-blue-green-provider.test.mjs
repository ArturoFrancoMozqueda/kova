import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { URL } from "node:url";
import { Buffer } from "node:buffer";
import gateway from "../../deploy/cloudflare-backend/gateway.mjs";
import { nativeBlueGreenProvider, validateNativeSlots } from "./native-blue-green-provider.mjs";
import { slotWorker } from "./native-slots.mjs";
const { Request, Response } = globalThis;

const previous = "a".repeat(40), target = "b".repeat(40);
const version = "11111111-2222-4333-8444-555555555555";
const coreVersion = "22222222-2222-4333-8444-555555555555";
const baseline = () => ({ version: 1, activeSlot: "legacy", coreSourceSha: previous,
  activeReleaseSha: previous, activeProcessId: "a".repeat(32), slots: { blue: null, green: null } });
const versions = { "kova-backend": coreVersion, "kova-backend-jobs": version, "kova-backend-gateway": version };

test("slot capture rejects incomplete, foreign registry, mismatched release and active-absent records", () => {
  assert.deepEqual(validateNativeSlots(baseline()), baseline());
  const record = { workerVersion: version, applicationId: version,
    namespaceId: "f".repeat(32), image: `registry.cloudflare.com/47d850c847503be3597dc7165cfea177/kova-api-green:${"c".repeat(12)}`,
    releaseSha: previous };
  assert.equal(validateNativeSlots({ ...baseline(), activeSlot: "green", slots: { blue: null, green: record } }).activeSlot, "green");
  for (const input of [null, {}, { ...baseline(), activeSlot: "green" },
    { ...baseline(), activeProcessId: "missing" }, { ...baseline(), coreSourceSha: "short" },
    { ...baseline(), slots: { blue: null, green: { ...record, image: "registry.other.test/unreviewed:latest" } } },
    { ...baseline(), activeSlot: "green", slots: { blue: null, green: { ...record, releaseSha: target } } }]) {
    assert.throws(() => validateNativeSlots(input));
  }
});

async function httpFixture(t, { failCandidate = false } = {}) {
  const state = { active: "legacy", candidate: null, ready: false, clock: 1_000_000,
    writes: { legacy: 0, green: 0 }, events: [], wroteWhileWarming: false };
  const servers = [];
  const origins = {};
  for (const slot of ["legacy", "green"]) {
    const server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (slot === "green" && !state.ready) { response.writeHead(503); response.end("{}"); return; }
      const sha = slot === "legacy" ? previous : target;
      response.setHeader("x-kova-runtime", "native-resident");
      response.setHeader("x-kova-process-id", (slot === "legacy" ? "a" : "b").repeat(32));
      response.setHeader("x-kova-controller-sha", sha);
      response.setHeader("x-kova-boot-controller-sha", sha);
      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        assert.equal(body, '{"sale":"once"}');
        assert.equal(request.headers["idempotency-key"], "original-sale-key");
        state.writes[slot]++;
        response.writeHead(201);
        response.end(JSON.stringify({ recorded: true, slot }));
      } else response.end(JSON.stringify({ status: "ok", release_sha: sha,
        ...(request.url === "/health/db" ? { db: "reachable" } : {}) }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    origins[slot] = `http://127.0.0.1:${server.address().port}`;
  }
  const stub = slot => ({
    async fetch(request) {
      const url = new URL(request.url);
      return globalThis.fetch(origins[slot] + url.pathname, request);
    },
    async probe() {
      const response = await globalThis.fetch(origins[slot] + "/health");
      const body = await response.json();
      if (!response.ok) throw new Error("Candidate not yet ready");
      return { ...body, processId: response.headers.get("x-kova-process-id"),
        controller: response.headers.get("x-kova-controller-sha"),
        boot: response.headers.get("x-kova-boot-controller-sha"), replaceable: false,
        offerVerified: true, offerRevision: "offer-v1-" + "f".repeat(64) };
    },
  });
  const server = createServer(async (incoming, outgoing) => {
    try {
      let body = "";
      for await (const chunk of incoming) body += chunk;
      const request = new Request("https://api.kovasuite.com" + incoming.url, {
        method: incoming.method, headers: incoming.headers,
        ...(body ? { body } : {}),
      });
      const response = await gateway.fetch(request, { KOVA_NATIVE_BACKEND: "1",
        API: { getByName: () => stub(state.active) },
        ...(state.candidate ? { CANDIDATE_API: { getByName: () => stub(state.candidate) },
          KOVA_NATIVE_CANDIDATE_SLOT: state.candidate } : {}),
      }, { waitUntil() {} });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const publicOrigin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const item of servers) item.closeAllConnections();
    await Promise.all(servers.map(item => new Promise(resolve => item.close(resolve))));
  });
  const fetcher = (url, options) => globalThis.fetch(publicOrigin + new URL(url).pathname, options);
  const write = async () => {
    const response = await globalThis.fetch(publicOrigin + "/api/v1/sales", { method: "POST",
      headers: { "Idempotency-Key": "original-sale-key", "content-type": "application/json" }, body: '{"sale":"once"}' });
    assert.equal(response.status, 201);
    return response.json();
  };
  const run = async (_command, args, options) => {
    if (!args[0].endsWith("/cf")) {
      state.events.push({ kind: "build", file: args[0], active: state.active });
      return "";
    }
    const command = args.slice(1);
    if (command.slice(0, 3).join(" ") === "workers deployments list") {
      const worker = command[command.indexOf("--script-name") + 1];
      return JSON.stringify({ deployments: [{ versions: [{ version_id: worker === "kova-backend" ? coreVersion : version,
        percentage: 100 }] }] });
    }
    if (command.slice(0, 3).join(" ") === "workers versions get") {
      return JSON.stringify({ id: version, env: {
        API: { type: "durable_object_namespace", class_name: "KovaApi", script_name: slotWorker(state.active) },
        ...(state.active === "legacy" ? {} : { KOVA_NATIVE_ACTIVE_SLOT: { type: "plain_text", text: state.active } }),
        ...(state.candidate ? { KOVA_NATIVE_CANDIDATE_SLOT: { type: "plain_text", text: state.candidate } } : {}),
      } });
    }
    if (command.slice(0, 3).join(" ") === "workers deployments create") {
      state.events.push({ kind: "restore", worker: command[command.indexOf("--script-name") + 1] });
      state.active = "legacy"; state.candidate = null;
      return "";
    }
    if (command[0] !== "deploy") assert.fail("Unexpected provider operation: " + command.slice(0, 3).join(" "));
    const worker = command[command.indexOf("--worker") + 1];
    if (command.includes("--dry-run")) return "";
    state.events.push({ kind: "publish", worker, active: options.env.KOVA_NATIVE_ACTIVE_SLOT });
    assert.notEqual(worker, "kova-backend", "the serving legacy controller must never be republished");
    if (worker === "kova-backend-gateway") {
      if (options.env.KOVA_NATIVE_ACTIVE_SLOT === "green") assert.equal(state.ready, true, "traffic switched before readiness");
      state.active = options.env.KOVA_NATIVE_ACTIVE_SLOT;
      state.candidate = options.env.KOVA_NATIVE_CANDIDATE_SLOT;
    }
    return "";
  };
  const provider = nativeBlueGreenProvider({ run, env: {}, fetcher, now: () => state.clock,
    wait: async () => {
      assert.equal(state.active, "legacy");
      if (!state.wroteWhileWarming) {
        state.wroteWhileWarming = true;
        assert.equal((await write()).slot, "legacy");
      }
      state.clock += failCandidate ? 600_000 : 1000;
      if (!failCandidate) state.ready = true;
    } });
  return { state, provider, write, fetcher };
}

test("independent publication serves a real HTTP write on the old process while the candidate warms", async t => {
  const fixture = await httpFixture(t);
  await fixture.provider.publish(target, previous, baseline());
  const response = await fixture.fetcher("https://api.kovasuite.com/health");
  assert.equal((await response.json()).release_sha, target);
  assert.equal(response.headers.get("x-kova-process-id"), "b".repeat(32));
  assert.deepEqual(fixture.state.writes, { legacy: 1, green: 0 });
  assert.deepEqual(fixture.state.events.filter(event => event.kind === "publish").map(event => event.worker),
    ["kova-api-green", "kova-backend-gateway", "kova-backend-gateway"]);
});

test("candidate startup failure preserves real HTTP service and recovery changes only the gateway", async t => {
  const fixture = await httpFixture(t, { failCandidate: true });
  await assert.rejects(fixture.provider.publish(target, previous, baseline()), /Candidate API failed readiness/);
  assert.equal(fixture.state.active, "legacy");
  await fixture.provider.restore(versions, baseline());
  const response = await fixture.fetcher("https://api.kovasuite.com/health");
  assert.equal((await response.json()).release_sha, previous);
  assert.equal(response.headers.get("x-kova-process-id"), baseline().activeProcessId);
  assert.deepEqual(fixture.state.writes, { legacy: 1, green: 0 });
  assert.deepEqual(fixture.state.events.filter(event => event.kind === "restore"),
    [{ kind: "restore", worker: "kova-backend-gateway" }]);
});

test("rollback after promotion returns to the original process without restoring either Container image", async t => {
  const fixture = await httpFixture(t);
  await fixture.provider.publish(target, previous, baseline());
  assert.equal((await fixture.write()).slot, "green");
  await fixture.provider.restore(versions, baseline());
  const response = await fixture.fetcher("https://api.kovasuite.com/health");
  assert.equal((await response.json()).release_sha, previous);
  assert.equal(response.headers.get("x-kova-process-id"), baseline().activeProcessId);
  assert.deepEqual(fixture.state.writes, { legacy: 1, green: 1 });
  assert.equal(fixture.state.events.some(event => event.kind === "restore" && event.worker !== "kova-backend-gateway"), false);
});

for (const active of ["green", "blue"]) {
  test(`reusing ${active === "green" ? "blue" : "green"} drains before mutation and promotes a new process even at the same SHA`, async () => {
    const candidate = active === "green" ? "blue" : "green";
    const processIds = { [active]: "a".repeat(32), [candidate]: "b".repeat(32) };
    const record = slot => ({ workerVersion: version, applicationId: version, namespaceId: "f".repeat(32),
      image: `registry.cloudflare.com/47d850c847503be3597dc7165cfea177/kova-api-${slot}:${previous.slice(0, 12)}`,
      releaseSha: previous });
    const snapshot = { ...baseline(), activeSlot: active, slots: { blue: record("blue"), green: record("green") } };
    let route = active, staged, clock = 1_000_000, drainChecks = 0, drained = false, published = false, publication;
    const fetcher = async url => {
      const path = new URL(url).pathname;
      if (path === "/health/candidate/drain") {
        assert.equal(route, active); assert.equal(published, false); assert.equal(staged, candidate);
        drained = ++drainChecks > 1;
        return Response.json({ release_sha: previous, replaceable: drained });
      }
      const slot = path === "/health/candidate" ? staged : route;
      return Response.json({ status: "ok", release_sha: previous, db: "reachable", offer_verified: true },
        { headers: { "x-kova-process-id": processIds[slot], "x-kova-controller-sha": previous,
          "x-kova-boot-controller-sha": previous } });
    };
    const run = async (_command, args, options) => {
      if (!args[0].endsWith("/cf")) return "";
      const command = args.slice(1);
      if (command.slice(0, 3).join(" ") === "workers deployments list") {
        return JSON.stringify({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] });
      }
      if (command.slice(0, 3).join(" ") === "workers versions get") {
        return JSON.stringify({ id: version, env: {
          API: { type: "durable_object_namespace", class_name: "KovaApi", script_name: slotWorker(route) },
          KOVA_NATIVE_ACTIVE_SLOT: { type: "plain_text", text: route },
        } });
      }
      assert.equal(command[0], "deploy");
      if (command.includes("--dry-run")) return "";
      const worker = command[command.indexOf("--worker") + 1];
      if (worker === slotWorker(candidate)) {
        assert.equal(drained, true); assert.equal(route, active); published = true;
      } else {
        assert.equal(worker, "kova-backend-gateway");
        route = options.env.KOVA_NATIVE_ACTIVE_SLOT; staged = options.env.KOVA_NATIVE_CANDIDATE_SLOT;
        if (route === candidate) assert.equal(published, true);
      }
      return "";
    };
    const provider = nativeBlueGreenProvider({ run, env: {}, fetcher, now: () => clock,
      wait: async ms => { clock += ms; }, onCandidateReady: value => { publication = value; } });
    await provider.publish(previous, previous, snapshot);
    assert.equal(drainChecks, 2); assert.equal(route, candidate);
    assert.equal(publication.processId, processIds[candidate]);
    assert.equal(publication.previousProcessId, processIds[active]);
  });
}

test("first bootstrap preserves the legacy image, process, public offer and database bindings", async () => {
  const image = `registry.cloudflare.com/47d850c847503be3597dc7165cfea177/kova-native-api:${previous.slice(0, 12)}`;
  const ids = { STRIPE_ESENCIAL_PRICE_ID: "price_Esencial", STRIPE_GESTION_PRICE_ID: "price_Gestion",
    STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Standard", STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Tiered" };
  const commands = []; let installed = false, signupInstalled = false;
  const run = async (_command, args, options) => {
    if (!args[0].endsWith("/cf")) { commands.push({ args, env: options.env }); return ""; }
    const command = args.slice(1);
    if (command.slice(0, 2).join(" ") === "workers list") {
      return JSON.stringify(["kova-backend", ...(signupInstalled ? ["kova-native-signup-settings"] : [])]
        .map(name => ({ name })));
    }
    if (command.slice(0, 3).join(" ") === "workers deployments list") {
      return JSON.stringify({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] });
    }
    if (command.slice(0, 3).join(" ") === "workers versions get") {
      const worker = command[command.indexOf("--worker-id") + 1];
      if (worker === "kova-native-signup-settings") return JSON.stringify({ id: version,
        env: { KOVA_NATIVE_SIGNUP_SOURCE_SHA: { type: "plain_text", text: target } } });
      return JSON.stringify({ id: version, ...(installed && worker === "kova-backend"
        ? { exports: { NativeSettings: { type: "worker" } } } : {}), env: {
        API: { type: "durable_object_namespace", class_name: "KovaApi", script_name: "kova-backend" },
        KOVA_BUILD_SHA: { type: "plain_text", text: previous },
        ...(installed ? { KOVA_NATIVE_CORE_SOURCE_SHA: { type: "plain_text", text: target } } : {}),
        ...Object.fromEntries(Object.entries(ids).map(([key, text]) => [key, { type: "plain_text", text }])),
        DB_APP: { type: "hyperdrive", id: "1".repeat(32) },
        DB_PRIVILEGED: { type: "hyperdrive", id: "2".repeat(32) },
      } });
    }
    commands.push({ args: command, env: options.env });
    if (command[command.indexOf("--worker") + 1] === "kova-backend" && !command.includes("--dry-run")) installed = true;
    if (command[command.indexOf("--worker") + 1] === "kova-native-signup-settings" && !command.includes("--dry-run")) signupInstalled = true;
    return "";
  };
  const fetcher = async () => Response.json({ status: "ok", release_sha: previous }, { headers: {
    "x-kova-process-id": "a".repeat(32), "x-kova-controller-sha": previous, "x-kova-boot-controller-sha": previous } });
  const provider = nativeBlueGreenProvider({ run, env: { GITHUB_SHA: target }, fetcher,
    git: args => args[0] === "rev-parse" ? target : "" });
  await provider.prepare({ releaseSha: previous, cloudflareNativeContainer: { image } });
  const coreCommands = commands.filter(item => item.args.includes("kova-backend"));
  assert.equal(coreCommands.length, 2);
  for (const item of coreCommands) {
    assert.equal(item.args.at(-1) === "--dry-run" || item.args.at(-1) === "none", true);
    assert.equal(item.args[item.args.indexOf("--containers-rollout") + 1], "none");
    assert.equal(item.env.KOVA_NATIVE_CORE_IMAGE, image);
    assert.equal(item.env.KOVA_BUILD_SHA, previous);
    assert.equal(item.env.KOVA_NATIVE_CORE_SOURCE_SHA, target);
    assert.equal(item.env.KOVA_HYPERDRIVE_APP_ID, "1".repeat(32));
    assert.equal(item.env.KOVA_HYPERDRIVE_PRIVILEGED_ID, "2".repeat(32));
    for (const [key, value] of Object.entries(ids)) assert.equal(item.env[key], value);
  }
  const before = commands.length;
  await provider.prepare({ releaseSha: previous, cloudflareNativeContainer: { image } });
  assert.equal(commands.length, before, "installed holder must never be redeployed by normal releases");
  const changed = nativeBlueGreenProvider({ run, env: { GITHUB_SHA: target }, fetcher,
    git: args => { if (args[0] === "diff" && args.length > 4) throw new Error("changed source"); return target; } });
  await assert.rejects(changed.prepare({}), /separate control-plane migration/);
  assert.equal(commands.length, before);
});

for (const scenario of ["fresh", "already_present", "appeared", "foreign_identity", "unavailable"]) {
  test(`a blocked inactive slot uses only a captured-absent bounded spare: ${scenario}`, async () => {
    const record = slot => ({ workerVersion: version, applicationId: version,
      namespaceId: "f".repeat(32), releaseSha: previous,
      image: `registry.cloudflare.com/47d850c847503be3597dc7165cfea177/kova-api-${slot}:${previous.slice(0, 12)}` });
    const snapshot = { ...baseline(), version: 2, activeSlot: "blue",
      slots: { blue: record("blue"), green: record("green"),
        recovery: scenario === "already_present" ? record("recovery") : null } };
    let route = "blue", candidate = "green", clock = 0, warmed = false;
    const mutations = [];
    const run = async (_command, args, options) => {
      if (!args[0].endsWith("/cf")) return "";
      const command = args.slice(1);
      if (command.slice(0, 3).join(" ") === "workers deployments list") {
        return JSON.stringify({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] });
      }
      if (command.slice(0, 3).join(" ") === "workers versions get") {
        return JSON.stringify({ id: version, env: {
          API: { type: "durable_object_namespace", class_name: "KovaApi", script_name: slotWorker(route) },
          KOVA_NATIVE_ACTIVE_SLOT: { type: "plain_text", text: route } } });
      }
      if (command.slice(0, 2).join(" ") === "workers list") {
        return JSON.stringify(["kova-api-blue", "kova-api-green",
          ...(scenario === "appeared" ? ["kova-api-recovery"] : [])].map(name => ({ name })));
      }
      if (command.slice(0, 3).join(" ") === "containers applications list") return "[]";
      assert.equal(command[0], "deploy");
      if (command.includes("--dry-run")) return "";
      const worker = command[command.indexOf("--worker") + 1];
      mutations.push(worker);
      assert.ok(!["kova-api-blue", "kova-api-green", "kova-backend"].includes(worker));
      if (worker === "kova-api-recovery") { assert.equal(route, "blue"); warmed = true; }
      else {
        assert.equal(worker, "kova-backend-gateway");
        route = options.env.KOVA_NATIVE_ACTIVE_SLOT;
        candidate = options.env.KOVA_NATIVE_CANDIDATE_SLOT;
        if (route === "recovery") assert.equal(warmed, true);
      }
      return "";
    };
    const fetcher = async url => {
      const path = new URL(url).pathname;
      if (path.endsWith("/drain")) {
        assert.equal(route, "blue"); assert.equal(candidate, "green");
        return Response.json({ release_sha: scenario === "foreign_identity" ? "f".repeat(40) : previous,
          replaceable: false }, { status: scenario === "unavailable" ? 503 : 200 });
      }
      const serving = path === "/health/candidate" ? candidate : route;
      const sha = serving === "recovery" ? target : previous;
      return Response.json({ status: "ok", release_sha: sha, db: "reachable", offer_verified: true },
        { headers: { "x-kova-process-id": (serving === "recovery" ? "b" : "a").repeat(32),
          "x-kova-controller-sha": sha, "x-kova-boot-controller-sha": sha } });
    };
    const provider = nativeBlueGreenProvider({ run, env: {}, fetcher, now: () => clock,
      wait: async () => { clock += 900_000; } });
    if (scenario === "fresh") {
      const result = await provider.publish(target, previous, snapshot);
      assert.equal(result.slot, "recovery");
      assert.equal(result.previousProcessId, "a".repeat(32));
      assert.equal(result.processId, "b".repeat(32));
      assert.equal(route, "recovery");
      assert.equal(mutations.filter(worker => worker === "kova-api-recovery").length, 1);
    } else {
      await assert.rejects(provider.publish(target, previous, snapshot));
      assert.equal(route, "blue");
      assert.deepEqual(mutations, ["kova-backend-gateway"]);
    }
  });
}

const transport = code => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(
  new Error(`connect ${code} 10.0.0.1:443 Authorization: secret`), { code }) });

function scriptedProvider({ route: initialRoute = "legacy", staged: initialStaged = null, script }) {
  let route = initialRoute, staged = initialStaged, clock = 1_000_000;
  const calls = {}, mutations = [];
  const fetcher = async url => {
    const path = new URL(url).pathname;
    const queue = script[path] ?? [];
    const index = calls[path] = (calls[path] ?? -1) + 1;
    const step = queue[Math.min(index, queue.length - 1)];
    if (typeof step === "string") throw transport(step);
    if (step?.status) return new Response("{}", { status: step.status });
    const slot = path === "/health/candidate" ? staged : route;
    const sha = step?.sha ?? (slot === "legacy" ? previous : target);
    const body = path.endsWith("/drain") ? { release_sha: sha, replaceable: step?.replaceable ?? true }
      : { status: "ok", release_sha: sha, db: "reachable", offer_verified: true };
    return Response.json(body, { headers: { "x-kova-process-id": (slot === "legacy" ? "a" : "b").repeat(32),
      "x-kova-controller-sha": sha, "x-kova-boot-controller-sha": sha } });
  };
  const run = async (_command, args, options) => {
    if (!args[0].endsWith("/cf")) return "";
    const command = args.slice(1);
    if (command.slice(0, 3).join(" ") === "workers deployments list") {
      const worker = command[command.indexOf("--script-name") + 1];
      return JSON.stringify({ deployments: [{ versions: [{ version_id: worker === "kova-backend" ? coreVersion : version,
        percentage: 100 }] }] });
    }
    if (command.slice(0, 3).join(" ") === "workers versions get") {
      return JSON.stringify({ id: version, env: {
        API: { type: "durable_object_namespace", class_name: "KovaApi", script_name: slotWorker(route) },
        ...(route === "legacy" ? {} : { KOVA_NATIVE_ACTIVE_SLOT: { type: "plain_text", text: route } }),
        ...(staged ? { KOVA_NATIVE_CANDIDATE_SLOT: { type: "plain_text", text: staged } } : {}) } });
    }
    if (command.slice(0, 3).join(" ") === "workers deployments create") {
      mutations.push("restore"); route = "legacy"; staged = null; return "";
    }
    assert.equal(command[0], "deploy");
    if (command.includes("--dry-run")) return "";
    const worker = command[command.indexOf("--worker") + 1];
    mutations.push(worker);
    if (worker === "kova-backend-gateway") {
      route = options.env.KOVA_NATIVE_ACTIVE_SLOT; staged = options.env.KOVA_NATIVE_CANDIDATE_SLOT;
    }
    return "";
  };
  const provider = nativeBlueGreenProvider({ run, env: {}, fetcher, now: () => clock,
    wait: async ms => { clock += ms; } });
  return { provider, calls, mutations, get route() { return route; } };
}

test("a transient transport reset while the candidate warms is retried and then publishes", async () => {
  const fixture = scriptedProvider({ script: { "/health/candidate": ["ECONNRESET", "UND_ERR_SOCKET", {}] } });
  const result = await fixture.provider.publish(target, previous, baseline());
  assert.equal(result.processId, "b".repeat(32));
  assert.equal(fixture.calls["/health/candidate"], 2);
  assert.equal(fixture.route, "green");
});

for (const [code, pattern] of [["ENOTFOUND", /dns_not_found/], ["CERT_HAS_EXPIRED", /certificate/]]) {
  test(`${code} while the candidate warms fails closed on the first try`, async () => {
    const fixture = scriptedProvider({ script: { "/health/candidate": [code, {}] } });
    await assert.rejects(fixture.provider.publish(target, previous, baseline()), error => {
      assert.match(error.message, pattern);
      assert.doesNotMatch(error.message, /secret|10\.0\.0\.1|kovasuite/);
      return true;
    });
    assert.equal(fixture.calls["/health/candidate"], 0);
    assert.equal(fixture.route, "legacy");
    assert.deepEqual(fixture.mutations, ["kova-api-green", "kova-backend-gateway"]);
  });
}

test("a foreign candidate identity after a transport reset still fails closed", async () => {
  const fixture = scriptedProvider({ script: { "/health/candidate": ["ECONNRESET", { sha: "f".repeat(40) }] } });
  await assert.rejects(fixture.provider.publish(target, previous, baseline()), /uncaptured release identity/);
  assert.equal(fixture.route, "legacy");
});

test("persistent transport resets exhaust the unchanged budget and report a sanitized last failure", async () => {
  const fixture = scriptedProvider({ script: { "/health/candidate": ["ECONNRESET"] } });
  await assert.rejects(fixture.provider.publish(target, previous, baseline()), error => {
    assert.match(error.message, /Candidate API failed readiness.*cause=ECONNRESET/);
    assert.doesNotMatch(error.message, /secret|10\.0\.0\.1|kovasuite/);
    return true;
  });
  assert.equal(fixture.calls["/health/candidate"], 599);
  assert.equal(fixture.route, "legacy");
});

test("rollback warming retries a transport reset and restores the exact old process", async () => {
  const fixture = scriptedProvider({ route: "green", staged: "legacy",
    script: { "/health/candidate": ["ECONNRESET", "ECONNREFUSED", {}] } });
  const result = await fixture.provider.restore(versions, baseline());
  assert.equal(result.processId, baseline().activeProcessId);
  assert.equal(result.previousProcessId, "b".repeat(32));
  assert.deepEqual(fixture.mutations, ["restore"]);
  assert.equal(fixture.route, "legacy");
});

test("rollback warming fails closed on DNS failure and on a foreign identity after a reset", async () => {
  const dns = scriptedProvider({ route: "green", staged: "legacy", script: { "/health/candidate": ["ENOTFOUND"] } });
  await assert.rejects(dns.provider.restore(versions, baseline()), /dns_not_found/);
  assert.deepEqual(dns.mutations, []);
  const foreign = scriptedProvider({ route: "green", staged: "legacy",
    script: { "/health/candidate": ["ECONNRESET", { sha: "f".repeat(40) }] } });
  await assert.rejects(foreign.provider.restore(versions, baseline()), /foreign release/);
  assert.deepEqual(foreign.mutations, []);
});

test("the drain gate tolerates a transport reset but never a DNS failure or unexpected status", async () => {
  const record = slot => ({ workerVersion: version, applicationId: version, namespaceId: "f".repeat(32),
    image: `registry.cloudflare.com/47d850c847503be3597dc7165cfea177/kova-api-${slot}:${previous.slice(0, 12)}`,
    releaseSha: previous });
  const snapshot = { ...baseline(), activeSlot: "green", activeProcessId: "b".repeat(32), activeReleaseSha: target,
    slots: { blue: record("blue"), green: { ...record("green"), releaseSha: target } } };
  const drain = steps => scriptedProvider({ route: "green", staged: "blue",
    script: { "/health": [{ sha: target }], "/health/candidate/drain": steps,
      "/health/candidate": [{ sha: previous }] } });
  const ok = drain(["ECONNRESET", { sha: previous, replaceable: true }]);
  await ok.provider.publish(previous, target, snapshot);
  assert.equal(ok.calls["/health/candidate/drain"], 1);
  assert.equal(ok.route, "blue");
  for (const [steps, pattern] of [[["ENOTFOUND"], /dns_not_found/], [[{ status: 503 }], /drain state/]]) {
    const failed = drain(steps);
    await assert.rejects(failed.provider.publish(previous, target, snapshot), pattern);
    assert.equal(failed.route, "green");
    assert.equal(failed.mutations.includes("kova-api-blue"), false);
  }
});

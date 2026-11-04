import assert from "node:assert/strict";
import { URL } from "node:url";
import { test } from "node:test";
import { backendWorkers, cloudflareBackendProvider, validateBackendVersions, waitForBackendRelease } from "./cloudflare-backend-provider.mjs";
import { cliProvider, recoverRelease, validateRollbackArtifact } from "./release-recovery.mjs";
import { release, releaseProvider } from "./release.mjs";
import { nativeContainerIdentity } from "./cloudflare-container-provider.mjs";

const version = "dcad4869-ba1d-43d4-865b-66349697bd7c";
const versions = Object.fromEntries(backendWorkers.map(name => [name, version]));
const sha = "a".repeat(40);
const env = { KOVA_CLOUDFLARE_BACKEND: "1", CLOUDFLARE_API_TOKEN: "test-only-cf",
  CLOUDFLARE_ACCOUNT_ID: "test-account", VERCEL_TOKEN: "test-only-vercel",
  KOVA_HYPERDRIVE_APP_ID: "test-runtime", KOVA_HYPERDRIVE_PRIVILEGED_ID: "test-owner",
  KOVA_WORKERS_PACKAGES: "/test/locked-packages", SUPABASE_DB_URL: "postgresql://test-only-owner" };
const artifact = { releaseSha: sha, cloudflareBackendVersions: versions,
  vercelDeployment: "https://old.vercel.app", frontendUrl: "https://kovasuite.com",
  backendUrl: "https://api.kovasuite.com" };
const publicStripeIds = {
  STRIPE_ESENCIAL_PRICE_ID: "price_Esencial123", STRIPE_GESTION_PRICE_ID: "price_Gestion123",
  STRIPE_STANDARD_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
  STRIPE_TIERED_PORTAL_CONFIGURATION_ID: "bpc_Basic123",
};

test("public Stripe transport rejects partial, malformed or uncaptured configuration before commands", async () => {
  const partial = { ...publicStripeIds }; delete partial.STRIPE_GESTION_PRICE_ID;
  for (const ids of [partial, { ...publicStripeIds, STRIPE_GESTION_PRICE_ID: "sk_" + "live_syntheticForbidden" },
    { ...publicStripeIds, STRIPE_GESTION_PRICE_ID: publicStripeIds.STRIPE_ESENCIAL_PRICE_ID }]) {
    const provider = cloudflareBackendProvider({ env: { ...env, ...ids }, run: assert.fail });
    await assert.rejects(provider.publish(sha, "b".repeat(40)));
  }
  const provider = cloudflareBackendProvider({ env: { ...env, ...publicStripeIds }, run: assert.fail });
  await assert.rejects(provider.publish(sha), /captured previous release SHA/);
});

test("public IDs reach API and job artifacts only through the normal captured release", async () => {
  const calls = [];
  const provider = cloudflareBackendProvider({ env: { ...env, ...publicStripeIds, KOVA_NATIVE_BACKEND: "1",
    CLOUDFLARE_ACCOUNT_ID: nativeContainerIdentity.accountId },
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes("secrets")) return JSON.stringify([
        { name: "APP_DATABASE_URL" }, { name: "MIGRATION_DATABASE_URL" },
        { name: "STRIPE_SECRET_KEY" }, { name: "STRIPE_WEBHOOK_SECRET" },
      ]);
      if (args.some(argument => argument.endsWith("/build.mjs"))) {
        for (const [name, value] of Object.entries(publicStripeIds)) assert.equal(options.env[name], value);
        assert.equal(options.env.SUPABASE_DB_URL, undefined);
      }
      if (args.includes("deploy")) {
        assert.equal(options.env.KOVA_NATIVE_PREVIOUS_SHA, "b".repeat(40));
        assert.equal(options.env.KOVA_NATIVE_DEPLOY_SHA, sha);
        assert.equal(args.includes("--secrets-file"), false);
      }
    } });
  await provider.publish(sha, "b".repeat(40));
  const inventories = calls.filter(call => call.args.includes("secrets"));
  assert.deepEqual(inventories.map(call => call.args.at(-1)), ["kova-backend", "kova-backend-jobs"]);
  assert.equal(calls.some(call => call.args.includes("put") || call.args.includes("delete")), false);
  assert.equal(calls.filter(call => call.args.some(argument => argument.endsWith("/build.mjs"))).length, 2);
  const deploys = calls.filter(call => call.args.includes("deploy") && !call.args.includes("--dry-run"));
  assert.deepEqual(deploys.map(call => call.args[call.args.indexOf("--worker") + 1]), backendWorkers);
});

for (const worker of ["kova-backend", "kova-backend-jobs"]) {
  test(`public text cannot shadow a sealed identifier in ${worker}`, async () => {
    const calls = [];
    const provider = cloudflareBackendProvider({ env: { ...env, ...publicStripeIds, KOVA_NATIVE_BACKEND: "1",
      CLOUDFLARE_ACCOUNT_ID: nativeContainerIdentity.accountId },
      run: async (_command, args) => {
        calls.push(args);
        assert.ok(args.includes("secrets") && args.includes("list"));
        return JSON.stringify([{ name: "APP_DATABASE_URL" }, { name: "MIGRATION_DATABASE_URL" },
          ...(args.at(-1) === worker ? [{ name: "STRIPE_ESENCIAL_PRICE_ID" }] : [])]);
      } });
    await assert.rejects(provider.publish(sha, "b".repeat(40)), /conflicts with an existing sealed binding/);
    assert.equal(calls.length, worker === "kova-backend" ? 1 : 2);
  });
}

test("rollback restores captured versions even when the current public IDs differ", async () => {
  const calls = [];
  const provider = cloudflareBackendProvider({ env: { ...env, ...publicStripeIds },
    run: async (_command, args) => calls.push(args) });
  await provider.restore(versions);
  assert.equal(calls.length, 3);
  for (const args of calls) {
    assert.ok(args.includes("deployments") && args.includes("create"));
    assert.deepEqual(JSON.parse(args.at(-1)), [{ version_id: version, percentage: 100 }]);
    assert.equal(args.includes("deploy"), false);
    assert.equal(args.includes("--bypass-deployment-checks"), false);
  }
});

test("backend readiness waits only for the known previous version before strict verification", async () => {
  let calls = 0;
  let waits = 0;
  await waitForBackendRelease({ backendUrl: artifact.backendUrl, sha: "b".repeat(40),
    previousSha: sha, wait: async ms => { assert.equal(ms, 500); waits++; },
    fetcher: async (url, options) => {
      assert.equal(url.href, `${artifact.backendUrl}/health`);
      assert.equal(options.headers["cache-control"], "no-cache");
      assert.ok(options.signal);
      return globalThis.Response.json({ status: "ok", release_sha: ++calls === 1 ? sha : "b".repeat(40) });
    } });
  assert.equal(calls, 2);
  assert.equal(waits, 1);
});

test("backend readiness rejects HTTP errors, malformed health and foreign commits immediately", async () => {
  for (const response of [new globalThis.Response("unavailable", { status: 503 }),
    globalThis.Response.json({}), globalThis.Response.json({ status: "ok" }),
    globalThis.Response.json({ status: "failed", release_sha: sha }),
    globalThis.Response.json({ status: "ok", release_sha: "c".repeat(40) }),
    new globalThis.Response("not json")]) {
    let calls = 0;
    await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
      previousSha: "b".repeat(40), wait: assert.fail,
      fetcher: async () => { calls++; return response; } }));
    assert.equal(calls, 1);
  }
  await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
    previousSha: "b".repeat(40), wait: assert.fail,
    // Unknown transport errors now fail closed with fixed diagnostics, never raw messages.
    fetcher: async () => { throw new Error("private network details"); } }), /target=direct cause=unknown/);
});

test("backend readiness retries only transient GETs without leaking bypass headers to direct", async () => {
  let clock = 0, direct = 0, proxy = 0;
  await waitForBackendRelease({ backendUrl: artifact.backendUrl,
    frontendUrl: "https://candidate.example.test", frontendBypassSecret: "synthetic-private-bypass",
    sha, previousSha: "b".repeat(40), now: () => clock, wait: async ms => { clock += ms; },
    fetcher: async (url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      if (url.hostname === new URL(artifact.backendUrl).hostname) {
        assert.equal(init.headers["x-vercel-protection-bypass"], undefined);
        if (++direct === 1) throw Object.assign(new Error("private raw error"), { code: "ECONNRESET" });
      } else {
        proxy++;
        assert.equal(init.headers["x-vercel-protection-bypass"], "synthetic-private-bypass");
      }
      return globalThis.Response.json({ status: "ok", release_sha: sha });
    },
  });
  assert.equal(direct, 2);
  assert.equal(proxy, 2);
  assert.equal(clock, 1000);
});

test("backend transient failures preserve attempt ceiling and the original deadline", async t => {
  let calls = 0;
  await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
    now: () => 0, wait: async () => {}, fetcher: async () => {
      calls++;
      throw Object.assign(new Error("private"), { code: "EAI_AGAIN" });
    } }), /did not finish propagating.*target=direct cause=EAI_AGAIN/);
  assert.equal(calls, 20);
  let clock = 0;
  const caps = [];
  t.mock.method(globalThis.AbortSignal, "timeout", ms => {
    caps.push(ms); return new globalThis.AbortController().signal;
  });
  await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl,
    frontendUrl: "https://candidate.example.test", sha, previousSha: "b".repeat(40),
    now: () => clock, wait: async ms => { clock += ms; },
    fetcher: async url => {
      if (url.pathname === "/health") {
        clock = 119_990;
        return globalThis.Response.json({ status: "ok", release_sha: "b".repeat(40) });
      }
      throw Object.assign(new Error("private"), { code: "ECONNRESET" });
    },
  }), /did not finish propagating.*target=candidate_proxy cause=ECONNRESET/);
  assert.deepEqual(caps, [20_000, 10]);
  assert.equal(clock, 120_000);
});

test("backend retry never accepts foreign health, malformed JSON or readiness after deadline", async () => {
  for (const response of [globalThis.Response.json({ status: "ok", release_sha: "c".repeat(40) }),
    new globalThis.Response("private token=never-forward-this")]) {
    let clock = 0, calls = 0;
    await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
      now: () => clock, wait: async ms => { clock += ms; }, fetcher: async () => {
        if (++calls === 1) throw Object.assign(new Error("private"), { code: "ECONNRESET" });
        return response;
      },
    }), error => !error.message.includes("never-forward-this"));
    assert.equal(calls, 2);
  }
  let clock = 0;
  await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
    now: () => clock, wait: assert.fail, fetcher: async () => {
      clock = 20_001;
      return globalThis.Response.json({ status: "ok", release_sha: sha });
    },
  }), /did not finish propagating/);
});

test("backend readiness has a bounded retry count and requires complete SHAs", async () => {
  let calls = 0;
  await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
    previousSha: "b".repeat(40), wait: async () => {},
    fetcher: async () => {
      calls++;
      return globalThis.Response.json({ status: "ok", release_sha: "b".repeat(40) });
    } }), /did not finish propagating/);
  assert.equal(calls, 20);
  for (const identities of [{ sha: "short" }, { sha, previousSha: "short" }]) {
    await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl,
      ...identities, fetcher: assert.fail, wait: assert.fail }), /complete release SHAs/);
  }
});

test("manual recovery without a known replaced SHA never tolerates another commit", async () => {
  await waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
    fetcher: async () => globalThis.Response.json({ status: "ok", release_sha: sha }), wait: assert.fail });
  await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
    fetcher: async () => globalThis.Response.json({ status: "ok", release_sha: "b".repeat(40) }),
    wait: assert.fail }), /Unexpected backend version/);
});

test("backend propagation also respects a wall-clock deadline", async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(waitForBackendRelease({ backendUrl: artifact.backendUrl, sha,
    previousSha: "b".repeat(40), now: () => clock,
    fetcher: async () => {
      calls++;
      clock = 19_950;
      return globalThis.Response.json({ status: "ok", release_sha: "b".repeat(40) });
    },
    wait: async ms => { assert.equal(ms, 50); clock += ms; },
  }), /did not finish propagating/);
  assert.equal(calls, 1);
  assert.equal(clock, 20_000);
});

test("backend deployment is opt-in and credentials are required before any command", () => {
  assert.equal(cloudflareBackendProvider({ env: {}, run: assert.fail }), undefined);
  assert.throws(() => cloudflareBackendProvider({ env: { KOVA_CLOUDFLARE_BACKEND: "1" } }), /credentials/);
  for (const invalid of [undefined, {}, { ...versions, extra: version },
    { ...versions, "kova-backend": "invalid" }]) {
    assert.throws(() => validateBackendVersions(invalid));
  }
});

test("capture requires one complete serving version for every backend Worker", async () => {
  const captured = [];
  const provider = cloudflareBackendProvider({ env, run: async (_command, args) => {
    captured.push(args[args.indexOf("--script-name") + 1]);
    return JSON.stringify({ deployments: [{ versions: [{ version_id: version, percentage: 100 }] }] });
  } });
  assert.deepEqual(await provider.capture(), versions);
  assert.deepEqual(captured, backendWorkers);
  for (const split of [[], [{ version_id: version, percentage: 50 }]]) {
    const broken = cloudflareBackendProvider({ env, run: async () =>
      JSON.stringify({ deployments: [{ versions: split }] }) });
    await assert.rejects(broken.capture(), /100%/);
  }
});

for (const failDeploy of [false, true]) {
  test(`backend release versions public identity without rotating secrets (failure=${failDeploy})`, async () => {
    const calls = [];
    const provider = cloudflareBackendProvider({ env, run: async (command, args, options) => {
      calls.push({ command, args });
      assert.ok(options.cwd.endsWith(command === "uv" ? "/backend" : "/deploy/cloudflare-backend"));
      for (const secret of [env.CLOUDFLARE_API_TOKEN, env.SUPABASE_DB_URL]) {
        assert.equal(args.join(" ").includes(secret), false);
      }
      if (command === "uv") assert.equal(options.env.MIGRATION_DATABASE_URL, env.SUPABASE_DB_URL);
      assert.equal(args.includes("--secrets-file"), false);
      if (args.some(value => value.endsWith("/build.mjs"))) {
        assert.equal(options.env.KOVA_BUILD_SHA, sha);
      }
      if (failDeploy && args.includes("deploy") && !args.includes("--dry-run")) {
        throw new Error("deployment failed");
      }
    } });
    if (failDeploy) await assert.rejects(provider.publish(sha), /deployment failed/);
    else await provider.publish(sha);
    assert.deepEqual(calls[0].args, ["run", "--frozen", "alembic", "upgrade", "head"]);
    assert.equal(calls.filter(call => call.args.includes("--dry-run")).length, 3);
    const deployed = calls.filter(call => call.args.includes("deploy") && !call.args.includes("--dry-run"));
    assert.deepEqual(deployed.map(call => call.args[call.args.indexOf("--worker") + 1]),
      failDeploy ? [backendWorkers[0]] : backendWorkers);
    assert.equal(calls.some(call => call.command.includes("flyctl")), false);
  });
}

test("missing migration inputs fail before building or modifying any service", async () => {
  for (const missing of ["KOVA_HYPERDRIVE_APP_ID", "KOVA_WORKERS_PACKAGES", "SUPABASE_DB_URL"]) {
    const provider = cloudflareBackendProvider({ env: { ...env, [missing]: "" }, run: assert.fail });
    await assert.rejects(provider.publish(sha));
  }
});

test("resident release refuses missing sealed runtime credentials before migrations", async () => {
  const calls = [];
  const provider = cloudflareBackendProvider({ env: { ...env, KOVA_NATIVE_BACKEND: "1",
    CLOUDFLARE_ACCOUNT_ID: nativeContainerIdentity.accountId },
    run: async (_command, args) => { calls.push(args); return JSON.stringify([{ name: "MIGRATION_DATABASE_URL" }]); } });
  await assert.rejects(provider.publish(sha, "b".repeat(40)), /provisioned APP_DATABASE_URL/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("list"));
});

test("resident release replaces only API artifact and preserves rollback workers and secrets", async () => {
  const calls = [];
  const provider = cloudflareBackendProvider({ env: { ...env, KOVA_NATIVE_BACKEND: "1",
    CLOUDFLARE_ACCOUNT_ID: nativeContainerIdentity.accountId },
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes("secrets")) return JSON.stringify([
        { name: "APP_DATABASE_URL" }, { name: "MIGRATION_DATABASE_URL" },
      ]);
      if (args.some(arg => arg.endsWith("/build.mjs"))) {
        assert.equal(options.env.SUPABASE_DB_URL, undefined);
        assert.equal(options.env.KOVA_BUILD_SHA, sha);
      }
      assert.equal(args.join(" ").includes(env.SUPABASE_DB_URL), false);
    } });
  await provider.publish(sha, "b".repeat(40));
  const deploys = calls.filter(call => call.args.includes("deploy") && !call.args.includes("--dry-run"));
  assert.deepEqual(deploys.map(call => call.args[call.args.indexOf("--worker") + 1]), backendWorkers);
  assert.ok(deploys[1].options.cwd.endsWith("/deploy/cloudflare-native"));
  assert.ok(deploys[0].options.cwd.endsWith("/deploy/cloudflare-backend"));
  assert.ok(deploys[2].options.cwd.endsWith("/deploy/cloudflare-backend"));
  assert.equal(calls.some(call => call.args.includes("put")), false);
  for (const call of calls.filter(call => call.options.cwd.endsWith("/deploy/cloudflare-native") && call.args.includes("deploy"))) {
    assert.equal(call.options.env.KOVA_NATIVE_PREVIOUS_SHA, "b".repeat(40));
    assert.equal(call.options.env.KOVA_NATIVE_DEPLOY_SHA, sha);
  }
});

test("resident publication rejects absent or malformed previous identities before any command", async () => {
  const provider = cloudflareBackendProvider({ env: { ...env, KOVA_NATIVE_BACKEND: "1",
    CLOUDFLARE_ACCOUNT_ID: nativeContainerIdentity.accountId }, run: assert.fail });
  for (const previousSha of [undefined, "", "short", "g".repeat(40)]) {
    await assert.rejects(provider.publish(sha, previousSha), /captured previous release SHA/);
  }
});

const absentContainer = { name: nativeContainerIdentity.name, namespaceId: nativeContainerIdentity.namespaceId,
  applicationId: null, image: null, instanceType: "lite", maxInstances: 1 };

test("resident releases require a captured image or explicit absence before creating a candidate", async () => {
  await assert.rejects(release({ artifact, sha, provider: {
    requiresNativeContainer: true, createCandidate: assert.fail,
  } }), /captured Container/);
});

test("first native cutover recovery verifies the restored Python runtime", async () => {
  let restored = false;
  await recoverRelease({ phase: "candidate", artifact: { ...artifact, cloudflareNativeContainer: absentContainer },
    failedSha: "b".repeat(40), provider: {
      requiresNativeContainer: true, requiresCloudflareBackend: true,
      async restoreCloudflareBackend(values, snapshot) {
        assert.deepEqual(values, versions); assert.deepEqual(snapshot, absentContainer); restored = true;
      },
      async waitForPublicBackend(input) {
        assert.ok(restored); assert.equal(input.nativeRuntime, false); assert.equal(input.sha, sha);
      },
    }, verify: async () => ({ accepted: true }) });
});

test("native rollback refuses an absent capture before restoring any Worker", async () => {
  const provider = cloudflareBackendProvider({ env: { ...env, KOVA_NATIVE_BACKEND: "1",
    CLOUDFLARE_ACCOUNT_ID: nativeContainerIdentity.accountId }, run: assert.fail });
  await assert.rejects(provider.restore(versions), /rollback identity/);
});

test("rollback restores all captured versions without rebuilding or invoking Fly", async () => {
  const calls = [];
  const provider = cloudflareBackendProvider({ env, run: async (_command, args) => calls.push(args) });
  await provider.restore(versions);
  assert.deepEqual(calls.map(args => args[args.indexOf("--script-name") + 1]),
    ["kova-backend", "kova-backend-jobs", "kova-backend-gateway"]);
  for (const args of calls) {
    assert.deepEqual(JSON.parse(args.at(-1)), [{ version_id: version, percentage: 100 }]);
    assert.equal(args.includes("--bypass-deployment-checks"), false);
  }
  await assert.rejects(provider.restore({ "kova-backend": version }));
  assert.equal(calls.length, 3);
});

test("Cloudflare recovery needs no Fly image or token and verifies the restored release", async () => {
  assert.equal(Object.hasOwn(validateRollbackArtifact(artifact), "flyImage"), false);
  const configured = cliProvider({ env, run: assert.fail });
  assert.equal(configured.requiresCloudflareBackend, true);
  const calls = [];
  const result = await recoverRelease({ phase: "acceptance", artifact, failedSha: "b".repeat(40), provider: {
    requiresCloudflareBackend: true,
    waitForPublicBackend: async input => {
      assert.equal(input.sha, sha); assert.equal(input.previousSha, "b".repeat(40));
      calls.push("backend-ready");
    },
    restoreVercel: async () => calls.push("frontend"), restoreFly: assert.fail,
    restoreCloudflareBackend: async captured => { assert.deepEqual(captured, versions); calls.push("backend"); },

  }, verify: async input => { assert.equal(input.sha, sha); calls.push("verified"); } });
  assert.deepEqual(calls, ["frontend", "backend", "backend-ready", "verified"]);
  assert.deepEqual(result.restored, ["vercel", "cloudflare-backend"]);
});

test("incomplete recovery capture fails before creating a candidate or restoring the frontend", async () => {
  const incomplete = { ...artifact, cloudflareBackendVersions: undefined, flyImage: "old-fly-image" };
  await assert.rejects(release({ artifact: incomplete, sha,
    provider: { requiresCloudflareBackend: true, createCandidate: assert.fail } }), /requires Cloudflare backend versions/);
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact: incomplete,
    provider: { requiresCloudflareBackend: true, restoreVercel: assert.fail } }), /requires Cloudflare backend versions/);
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact,
    provider: { restoreVercel: assert.fail } }), /configured provider/);
});

test("the normal release delegates backend publication to Cloudflare when selected", async () => {
  const commands = [];
  const provider = releaseProvider("/private-auth", { env, run: async (command, args) => commands.push({ command, args }) });
  await provider.deployBackend(sha);
  assert.equal(provider.requiresCloudflareBackend, true);
  assert.equal(commands[0].command, "uv");
  assert.equal(commands.some(call => call.command.includes("flyctl")), false);
  assert.equal(commands.filter(call => call.args.includes("--tag")).length, 3);
});

test("frontend candidate tooling never inherits the backend owner connection", async () => {
  const provider = releaseProvider("/private-auth", { env, run: async (_command, _args, options) => {
    assert.equal(options.env.SUPABASE_DB_URL, undefined);
  } });
  await provider.createCandidate();
});

function readinessFixture(sequence) {
  let clock = 0, round = 0;
  const calls = [];
  return {
    calls,
    now: () => clock,
    wait: async ms => { clock += ms; round++; },
    fetcher: async (url, options) => {
      calls.push({ url: String(url), options });
      const item = sequence[Math.min(round, sequence.length - 1)];
      const value = String(url).includes("/api/") ? (item.proxy ?? item.direct) : item.direct;
      if (typeof value === "number") return new globalThis.Response("unavailable", { status: value });
      return globalThis.Response.json(typeof value === "object" ? value : { status: "ok", release_sha: value });
    },
  };
}
const nextSha = "b".repeat(40);
const readinessInput = { backendUrl: artifact.backendUrl, frontendUrl: "https://candidate.vercel.app",
  sha: nextSha, previousSha: sha, frontendBypassSecret: "test-bypass" };

test("backend waits for captured previous identity on direct and proxy before exact target", async () => {
  const fake = readinessFixture([{ direct: sha }, { direct: nextSha, proxy: sha }, { direct: nextSha }]);
  await waitForBackendRelease({ ...readinessInput, ...fake });
  assert.equal(fake.calls.length, 6);
  assert.equal(fake.calls[0].options.headers["x-vercel-protection-bypass"], undefined);
  assert.equal(fake.calls[1].options.headers["x-vercel-protection-bypass"], "test-bypass");
  assert.equal(fake.calls[0].options.redirect, "error");
});

for (const value of ["c".repeat(40), "missing", { status: "bad", release_sha: sha }, 503, 403]) {
  test(`backend readiness rejects foreign/malformed/error immediately: ${JSON.stringify(value)}`, async () => {
    const fake = readinessFixture([{ direct: value }]);
    await assert.rejects(waitForBackendRelease({ ...readinessInput, ...fake }), /Unexpected backend|HTTP/);
    assert.equal(fake.now(), 0);
    assert.equal(fake.calls.length, 2);
  });
}

test("backend propagation exhaustion remains blocking", async () => {
  const fake = readinessFixture([{ direct: sha }]);
  await assert.rejects(waitForBackendRelease({ ...readinessInput, ...fake }), /did not finish propagating/);
  assert.equal(fake.calls.length, 240);
  assert.equal(fake.now(), 120_000);
});

test("recovery readiness converges from attempted candidate back to captured release", async () => {
  const fake = readinessFixture([{ direct: nextSha }, { direct: sha, proxy: nextSha }, { direct: sha }]);
  await waitForBackendRelease({ ...readinessInput, sha, previousSha: nextSha, ...fake });
  assert.equal(fake.calls.length, 6);
});

test("invalid backend propagation identities fail before requests", async () => {
  for (const input of [{ sha: "short" }, { previousSha: "short" }]) {
    await assert.rejects(waitForBackendRelease({ ...readinessInput, ...input, fetcher: assert.fail }), /complete.*SHAs/);
  }
});

test("Cloudflare candidate waits before verification and recovery uses the attempted identity", async () => {
  const calls = [];
  const provider = {
    requiresCloudflareBackend: true,
    createCandidate: async () => "https://candidate.vercel.app",
    deployBackend: async () => calls.push("deploy"),
    waitForPublicBackend: async input => {
      calls.push(input.sha === nextSha ? "candidate-ready" : "recovery-ready");
      assert.equal(input.previousSha, input.sha === nextSha ? sha : nextSha);
    },
    restoreCloudflareBackend: async () => calls.push("restore"),
    promote: assert.fail,
  };
  const verify = async input => {
    calls.push(input.sha === nextSha ? "candidate-verify" : "recovery-verify");
    if (input.sha === nextSha) throw new Error("candidate acceptance rejected");
  };
  await assert.rejects(release({ artifact, sha: nextSha, provider, verify }), /RELEASE_FAILED_RECOVERED/);
  assert.deepEqual(calls, ["deploy", "candidate-ready", "candidate-verify", "restore", "recovery-ready", "recovery-verify"]);
});

test("missing backend readiness fails before provider mutations", async () => {
  await assert.rejects(release({ artifact, sha: nextSha,
    provider: { requiresCloudflareBackend: true, createCandidate: assert.fail },
  }), /readiness verification/);
  await assert.rejects(recoverRelease({ phase: "candidate", artifact,
    provider: { restoreCloudflareBackend: assert.fail },
  }), /readiness verification/);
});

test("backend readiness failure prevents candidate verification and promotion", async () => {
  const calls = [];
  const provider = {
    requiresCloudflareBackend: true,
    createCandidate: async () => "https://candidate.vercel.app", deployBackend: async () => {},
    waitForPublicBackend: async input => {
      calls.push(input.sha === nextSha ? "candidate-wait" : "recovery-wait");
      if (input.sha === nextSha) throw new Error("Unexpected backend version during publication");
    },
    restoreCloudflareBackend: async () => calls.push("restore"), promote: assert.fail,
  };
  await assert.rejects(release({ artifact, sha: nextSha, provider,
    verify: async input => { assert.equal(input.sha, sha); calls.push("restored-verified"); },
  }), /RELEASE_FAILED_RECOVERED/);
  assert.deepEqual(calls, ["candidate-wait", "restore", "recovery-wait", "restored-verified"]);
});

test("a recovery propagation failure remains blocked before full verification", async () => {
  const calls = [];
  await assert.rejects(recoverRelease({ phase: "candidate", artifact, failedSha: nextSha,
    provider: {
      restoreCloudflareBackend: async () => calls.push("restore"),
      waitForPublicBackend: async () => { throw new Error("Unexpected backend version"); },
    }, verify: assert.fail,
  }), /RECOVERY_BLOCKED.*Unexpected backend version/);
  assert.deepEqual(calls, ["restore"]);
});

test("publication verifies candidate and public proxy readiness before each strict verification", async () => {
  const calls = [];
  const inputArtifact = { ...artifact, cloudflareVersion: version };
  const provider = {
    requiresCloudflareBackend: true, requiresCloudflare: true,
    createCandidate: async () => "https://candidate.vercel.app",
    deployBackend: async () => calls.push("deploy"), promote: async () => calls.push("promote"),
    waitForPublicFrontend: async input => {
      assert.equal(input.sha, nextSha); assert.equal(input.previousSha, sha); calls.push("public-frontend-ready");
    },
    waitForPublicBackend: async input => {
      assert.equal(input.sha, nextSha); assert.equal(input.previousSha, sha);
      calls.push(input.frontendUrl === artifact.frontendUrl ? "public-api-ready" : "candidate-api-ready");
    },
  };
  assert.equal((await release({ artifact: inputArtifact, sha: nextSha, provider,
    verify: async input => calls.push(input.frontendUrl === artifact.frontendUrl ? "public-verified" : "candidate-verified"),
  })).accepted, true);
  assert.deepEqual(calls, ["deploy", "candidate-api-ready", "candidate-verified", "promote",
    "public-frontend-ready", "public-api-ready", "public-verified"]);
});

test("recovery waits for restored frontend then API using only captured and attempted identities", async () => {
  const calls = [];
  const target = { ...artifact, cloudflareVersion: version };
  const assertInverse = input => {
    assert.equal(input.sha, sha); assert.equal(input.previousSha, nextSha);
    assert.equal(input.frontendUrl, artifact.frontendUrl);
  };
  await recoverRelease({ phase: "acceptance", artifact: target, failedSha: nextSha,
    provider: {
      restoreCloudflare: async () => calls.push("restore-frontend"),
      restoreVercel: async () => calls.push("restore-alias"),
      restoreCloudflareBackend: async () => calls.push("restore-api"),
      waitForPublicFrontend: async input => { assertInverse(input); calls.push("frontend-ready"); },
      waitForPublicBackend: async input => { assertInverse(input); calls.push("api-ready"); },
    }, verify: async input => { assert.equal(input.sha, sha); calls.push("strict-verified"); },
  });
  assert.deepEqual(calls, ["restore-frontend", "restore-alias", "restore-api", "frontend-ready", "api-ready", "strict-verified"]);
});

test("public proxy readiness failure blocks final acceptance and restores inverse readiness", async () => {
  const calls = [];
  const target = { ...artifact, cloudflareVersion: version };
  const provider = {
    requiresCloudflareBackend: true, requiresCloudflare: true,
    createCandidate: async () => "https://candidate.vercel.app", deployBackend: async () => {},
    promote: async () => calls.push("promote"),
    waitForPublicFrontend: async input => calls.push(input.sha === nextSha ? "frontend-published" : "frontend-restored"),
    waitForPublicBackend: async input => {
      if (input.frontendUrl === target.frontendUrl && input.sha === nextSha) {
        throw new Error("Unexpected public API version");
      }
      calls.push(input.sha === nextSha ? "candidate-ready" : "api-restored");
    },
    restoreCloudflare: async () => {}, restoreVercel: async () => {}, restoreCloudflareBackend: async () => {},
  };
  await assert.rejects(release({ artifact: target, sha: nextSha, provider,
    verify: async input => {
      assert.ok(input.frontendUrl !== target.frontendUrl || input.sha === sha);
      calls.push(input.sha === nextSha ? "candidate-verified" : "recovery-verified");
    },
  }), /RELEASE_FAILED_RECOVERED.*Unexpected public API version/);
  assert.deepEqual(calls, ["candidate-ready", "candidate-verified", "promote", "frontend-published",
    "frontend-restored", "api-restored", "recovery-verified"]);
});

test("restored frontend readiness failure blocks API readiness and full verification", async () => {
  await assert.rejects(recoverRelease({ phase: "promotion", artifact: { ...artifact, cloudflareVersion: version },
    failedSha: nextSha, provider: {
      restoreCloudflare: async () => {}, restoreVercel: async () => {}, restoreCloudflareBackend: async () => {},
      waitForPublicFrontend: async () => { throw new Error("Unexpected frontend version"); },
      waitForPublicBackend: assert.fail,
    }, verify: assert.fail,
  }), /RECOVERY_BLOCKED.*Unexpected frontend version/);
});

test("missing restored frontend readiness fails before any recovery mutation", async () => {
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact: { ...artifact, cloudflareVersion: version },
    failedSha: nextSha, provider: { restoreCloudflare: assert.fail, restoreCloudflareBackend: assert.fail,
      waitForPublicBackend: assert.fail },
  }), /frontend recovery requires readiness/);
});

test("backend readiness retains the full verifier timeout for cold Durable Objects", async () => {
  const timeout = globalThis.AbortSignal.timeout;
  const deadlines = [];
  globalThis.AbortSignal.timeout = milliseconds => {
    deadlines.push(milliseconds);
    return timeout(milliseconds);
  };
  try {
    const fake = readinessFixture([{ direct: nextSha }]);
    await waitForBackendRelease({ ...readinessInput, ...fake });
    assert.deepEqual(deadlines, [20_000, 20_000]);
  } finally {
    globalThis.AbortSignal.timeout = timeout;
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { backendWorkers, cloudflareBackendProvider, validateBackendVersions, waitForBackendRelease } from "./cloudflare-backend-provider.mjs";
import { cliProvider, recoverRelease, validateRollbackArtifact } from "./release-recovery.mjs";
import { release, releaseProvider } from "./release.mjs";

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
  assert.equal(validateRollbackArtifact(artifact).flyImage, "");
  const configured = cliProvider({ env, run: assert.fail });
  assert.equal(configured.requiresCloudflareBackend, true);
  const calls = [];
  const result = await recoverRelease({ phase: "acceptance", artifact, attemptedSha: "b".repeat(40), provider: {
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
    provider: { requiresCloudflareBackend: true, createCandidate: assert.fail } }), /captured rollback/);
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact: incomplete,
    provider: { requiresCloudflareBackend: true, restoreVercel: assert.fail } }), /captured rollback/);
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact,
    provider: { restoreVercel: assert.fail } }), /configured provider/);
});

test("the normal release delegates backend publication to Cloudflare when selected", async () => {
  const commands = [];
  const provider = releaseProvider("/private-auth", { env, run: async (command, args) => commands.push({ command, args }) });
  await provider.deployFly(sha);
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
  for (const input of [{ sha: "short" }, { previousSha: undefined }]) {
    await assert.rejects(waitForBackendRelease({ ...readinessInput, ...input, fetcher: assert.fail }), /complete SHAs/);
  }
});

test("Cloudflare candidate waits before verification and recovery uses the attempted identity", async () => {
  const calls = [];
  const provider = {
    requiresCloudflareBackend: true,
    createCandidate: async () => "https://candidate.vercel.app",
    deployFly: async () => calls.push("deploy"),
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
    createCandidate: async () => "https://candidate.vercel.app", deployFly: async () => {},
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
  await assert.rejects(recoverRelease({ phase: "candidate", artifact, attemptedSha: nextSha,
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
    deployFly: async () => calls.push("deploy"), promote: async () => calls.push("promote"),
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
  await recoverRelease({ phase: "acceptance", artifact: target, attemptedSha: nextSha,
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
    createCandidate: async () => "https://candidate.vercel.app", deployFly: async () => {},
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
    attemptedSha: nextSha, provider: {
      restoreCloudflare: async () => {}, restoreVercel: async () => {}, restoreCloudflareBackend: async () => {},
      waitForPublicFrontend: async () => { throw new Error("Unexpected frontend version"); },
      waitForPublicBackend: assert.fail,
    }, verify: assert.fail,
  }), /RECOVERY_BLOCKED.*Unexpected frontend version/);
});

test("missing restored frontend readiness fails before any recovery mutation", async () => {
  await assert.rejects(recoverRelease({ phase: "acceptance", artifact: { ...artifact, cloudflareVersion: version },
    attemptedSha: nextSha, provider: { restoreCloudflare: assert.fail, restoreCloudflareBackend: assert.fail,
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

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { backendReleasePlan, backendUnchanged } from "./backend-release-plan.mjs";
import { release } from "./release.mjs";
import { verifyDeployment } from "./verify-deployment.mjs";

function repositoryFixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "kova-release-plan-"));
  const git = args => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const put = (name, value = name) => {
    mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    writeFileSync(path.join(cwd, name), value);
  };
  const commit = () => {
    git(["add", "."]);
    git(["-c", "user.name=Kova QA", "-c", "user.email=qa@example.invalid", "commit", "-m", "fixture"]);
    return git(["rev-parse", "HEAD"]).trim();
  };
  git(["init", "--quiet"]);
  put("backend/app/main.py", "unchanged application\n");
  put("frontend/src/App.tsx", "old UI\n");
  const previousSha = commit();
  return { cwd, git, put, commit, previousSha, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("only known frontend, pipeline and Markdown changes can retain a backend", () => {
  assert.equal(backendUnchanged(["frontend/src/App.tsx", "frontend/scripts/release.mjs",
    "deploy/cloudflare/worker.mjs", "docs/despliegue.md", ".github/workflows/ci.yml"]), true);
  for (const name of ["backend/app/main.py", "backend/alembic/versions/0102.py",
    "backend/uv.lock", "deploy/cloudflare-native/policy.mjs", "deploy/cloudflare-backend/jobs.py",
    "deploy/public-images.mjs", "scripts/new-deployment-tool.py", "unrecognized", "docs/run.sh"])
    assert.equal(backendUnchanged(["frontend/src/App.tsx", name]), false, name);
  for (const input of [null, [], [42]]) assert.equal(backendUnchanged(input), false);
});

test("the production baseline, rather than the previous commit, controls backend reuse", () => {
  const repo = repositoryFixture();
  try {
    repo.put("backend/app/main.py", "backend changed earlier\n"); repo.commit();
    repo.put("frontend/src/App.tsx", "new UI\n");
    const sha = repo.commit();
    assert.deepEqual(backendReleasePlan({ ...repo, sha, eventName: "push" }),
      { publishBackend: true, backendSha: sha });
  } finally { repo.cleanup(); }
});

test("a UI change retains the exact deployed backend and manual configuration refresh remains full", () => {
  const repo = repositoryFixture();
  try {
    repo.put("frontend/src/new screen.tsx", "new UI\n");
    const sha = repo.commit();
    assert.deepEqual(backendReleasePlan({ ...repo, sha, eventName: "push" }),
      { publishBackend: false, backendSha: repo.previousSha });
    for (const eventName of ["", "workflow_dispatch", "pull_request"])
      assert.deepEqual(backendReleasePlan({ ...repo, sha, eventName }), { publishBackend: true, backendSha: sha });
  } finally { repo.cleanup(); }
});

test("moving a backend file into frontend cannot disguise a backend deletion", () => {
  const repo = repositoryFixture();
  try {
    renameSync(path.join(repo.cwd, "backend/app/main.py"), path.join(repo.cwd, "frontend/src/moved.py"));
    const sha = repo.commit();
    assert.deepEqual(backendReleasePlan({ ...repo, sha, eventName: "push" }),
      { publishBackend: true, backendSha: sha });
  } finally { repo.cleanup(); }
});

test("missing history retains full publication while unreviewed or dirty source cannot publish", () => {
  const repo = repositoryFixture();
  try {
    repo.put("frontend/src/App.tsx", "new UI\n");
    const sha = repo.commit();
    assert.deepEqual(backendReleasePlan({ ...repo, sha, previousSha: "f".repeat(40), eventName: "push" }),
      { publishBackend: true, backendSha: sha });
    assert.throws(() => backendReleasePlan({ ...repo, sha: repo.previousSha, eventName: "push" }), /source/);
    repo.put("frontend/src/App.tsx", "dirty source\n");
    assert.throws(() => backendReleasePlan({ ...repo, sha, eventName: "push" }), /unchanged reviewed/);
    assert.throws(() => backendReleasePlan({ sha: "invalid", previousSha: sha }), /complete/);
  } finally { repo.cleanup(); }
});

test("a frontend publication keeps a real HTTP backend serving and forwards one write once", async () => {
  const repo = repositoryFixture();
  let server;
  try {
    repo.put("frontend/src/App.tsx", "intermediate UI\n");
    const previousFrontendSha = repo.commit();
    repo.put("frontend/src/App.tsx", "new UI\n");
    const sha = repo.commit();
    let publicFrontendSha = previousFrontendSha;
    let writes = 0;
    let backendPublications = 0;
    server = createServer(async (request, response) => {
      const url = request.url;
      response.setHeader("content-type", "application/json");
      if (url === "/backend/orders" && request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        assert.equal(JSON.parse(body).client_uuid, "qa-single-write");
        writes++;
        response.writeHead(201);
        response.end(JSON.stringify({ order: writes }));
      } else if (url.endsWith("/health/db")) {
        response.end(JSON.stringify({ status: "ok", db: "reachable" }));
      } else if (url.endsWith("/health")) {
        response.setHeader("x-kova-runtime", "native-resident");
        response.setHeader("x-kova-controller-sha", repo.previousSha);
        response.setHeader("x-kova-boot-controller-sha", repo.previousSha);
        response.end(JSON.stringify({ status: "ok", release_sha: repo.previousSha }));
      } else if (url.endsWith("/version.json")) {
        response.end(JSON.stringify({ hash: (url.startsWith("/candidate/") ? sha : publicFrontendSha).slice(0, 12) }));
      } else {
        response.setHeader("content-type", "text/html");
        response.end("<!doctype html><html><title>Kova</title></html>");
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const artifact = { releaseSha: repo.previousSha, frontendSha: previousFrontendSha,
      frontendUrl: "https://kova.example", backendUrl: "https://api.kova.example",
      vercelDeployment: "https://old.vercel.app",
      cloudflareVersion: "dcad4869-ba1d-43d4-865b-66349697bd7c",
      cloudflareBackendVersions: Object.fromEntries(["kova-backend-jobs", "kova-backend", "kova-backend-gateway"]
        .map(name => [name, "dcad4869-ba1d-43d4-865b-66349697bd7c"])) };
    const observations = [];
    const result = await release({ artifact, sha, reuseBackend: true,
      planBackend: input => backendReleasePlan({ ...input, cwd: repo.cwd, eventName: "push" }),
      provider: {
        requiresCloudflare: true, requiresCloudflareBackend: true,
        createCandidate: async () => "https://candidate.vercel.app",
        deployBackend: async () => { backendPublications++; throw new Error("Would restart the healthy API"); },
        restoreCloudflareBackend: () => assert.fail("An untouched backend must not be restored"),
        waitForPublicBackend: async input => {
          assert.equal(input.sha, repo.previousSha);
          assert.equal((await globalThis.fetch(`${origin}/backend/health`)).status, 200);
        },
        promote: async () => {
          const response = await globalThis.fetch(`${origin}/backend/orders`, { method: "POST",
            body: JSON.stringify({ client_uuid: "qa-single-write" }) });
          assert.equal(response.status, 201);
          publicFrontendSha = sha;
        },
        waitForPublicFrontend: async input => {
          assert.equal(input.sha, sha);
          assert.equal(input.previousSha, previousFrontendSha);
        },
      },
      verify: async input => {
        observations.push([input.sha, input.frontendSha]);
        return verifyDeployment({ ...input, backendUrl: `${origin}/backend`,
          frontendUrl: origin + (input.frontendUrl.includes("candidate.") ? "/candidate" : "/public") });
      },
    });
    assert.equal(result.accepted, true);
    assert.equal(result.backendSha, repo.previousSha);
    assert.equal(backendPublications, 0);
    assert.equal(writes, 1);
    assert.deepEqual(observations, [[repo.previousSha, sha], [repo.previousSha, sha]]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    repo.cleanup();
  }
});

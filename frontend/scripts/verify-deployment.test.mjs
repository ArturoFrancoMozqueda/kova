import assert from "node:assert/strict";
import { createServer } from "node:http";
import { URL } from "node:url";
import { after, before, test } from "node:test";
import { verifyDeployment } from "./verify-deployment.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";
let origin;
let server;
const frontendBypassHeaders = [];

before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      frontendBypassHeaders.push(request.headers["x-vercel-protection-bypass"]);
      response.end("<!doctype html><html><title>Kova</title></html>");
    } else if (request.url === "/version.json") {
      response.setHeader("content-type", "application/json");
      frontendBypassHeaders.push(request.headers["x-vercel-protection-bypass"]);
      response.end(JSON.stringify({ hash: sha.slice(0, 12) }));
    } else if (request.url === "/health" || request.url === "/api/health") {
      response.setHeader("content-type", "application/json");
      if (request.url.startsWith("/api/")) {
        frontendBypassHeaders.push(request.headers["x-vercel-protection-bypass"]);
      }
      response.end(JSON.stringify({ status: "ok", release_sha: sha }));
    } else if (request.url === "/health/db" || request.url === "/api/health/db") {
      response.setHeader("content-type", "application/json");
      if (request.url.startsWith("/api/")) {
        frontendBypassHeaders.push(request.headers["x-vercel-protection-bypass"]);
      }
      response.end(JSON.stringify({ status: "ok", db: "reachable" }));
    } else {
      response.setHeader("content-type", "application/json");
      response.statusCode = 404;
      response.end(JSON.stringify({ detail: "not found" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("accepts matching frontend, backend, and database deployment contracts", async () => {
  frontendBypassHeaders.length = 0;
  const result = await verifyDeployment({
    frontendUrl: origin,
    backendUrl: origin,
    sha,
    frontendBypassSecret: "automation-test-secret",
  });
  assert.equal(result.commit, sha);
  assert.equal(result.site, "reachable");
  assert.equal(result.proxy, "reachable");
  assert.equal(result.database, "reachable");
  assert.deepEqual(frontendBypassHeaders, Array(4).fill("automation-test-secret"));
});

test("rejects a deployment from a different commit", async () => {
  await assert.rejects(
    verifyDeployment({ frontendUrl: origin, backendUrl: origin, sha: `f${sha.slice(1)}` }),
    /commit mismatch/,
  );
});

test("rejects a frontend whose API proxy does not reach the release", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (String(input).endsWith("/api/health")) {
      return new globalThis.Response(JSON.stringify({ status: "ok", release_sha: `f${sha.slice(1)}` }), {
        headers: { "content-type": "application/json" },
      });
    }
    return response;
  };
  try {
    await assert.rejects(
      verifyDeployment({ frontendUrl: origin, backendUrl: origin, sha }),
      /API proxy health contract failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public acceptance revalidates all six contracts after a captured previous frontend", async () => {
  const { verifyPublicDeployment } = await import("./verify-deployment.mjs");
  const previousSha = "a".repeat(40);
  const originalFetch = globalThis.fetch;
  let versions = 0;
  let requests = 0;
  let clock = 0;
  globalThis.fetch = async (input, init) => {
    requests++;
    assert.equal(init.headers["x-vercel-protection-bypass"], undefined);
    if (String(input).endsWith("/version.json")) {
      versions++;
      return globalThis.Response.json({ hash: versions === 1 ? previousSha.slice(0, 12) : sha.slice(0, 12) });
    }
    return originalFetch(input, init);
  };
  try {
    const result = await verifyPublicDeployment({ frontendUrl: origin, backendUrl: origin,
      sha, previousSha, now: () => clock, wait: async ms => { clock += ms; } });
    assert.equal(result.commit, sha);
    assert.equal(versions, 2);
    assert.equal(requests, 12);
    assert.equal(clock, 2000);
  } finally { globalThis.fetch = originalFetch; }
});

test("known previous frontend cannot hide backend, database, proxy, site or HTTP failures", async () => {
  const { verifyPublicDeployment, FrontendCommitMismatch } = await import("./verify-deployment.mjs");
  const previousSha = "a".repeat(40);
  for (const failure of ["backend", "database", "proxy", "site", "http"]) {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      requests++;
      const pathname = new URL(input).pathname;
      if (pathname === "/version.json") return globalThis.Response.json({ hash: previousSha.slice(0, 12) });
      if (failure === "backend" && pathname === "/health") return globalThis.Response.json({ status: "ok", release_sha: previousSha });
      if (failure === "database" && pathname === "/health/db") return globalThis.Response.json({ status: "ok", db: "unreachable" });
      if (failure === "proxy" && pathname === "/api/health") return globalThis.Response.json({ status: "ok", release_sha: previousSha });
      if (failure === "site" && pathname === "/") return new globalThis.Response("Invalid site", { headers: { "content-type": "text/plain" } });
      if (failure === "http" && pathname === "/health") return new globalThis.Response("Unavailable", { status: 503 });
      return originalFetch(input, init);
    };
    try {
      await assert.rejects(verifyPublicDeployment({ frontendUrl: origin, backendUrl: origin,
        sha, previousSha, wait: assert.fail }), error => {
        assert.equal(error instanceof FrontendCommitMismatch, false);
        return true;
      });
      assert.equal(requests, 6, failure);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("foreign and malformed frontend identities fail without retry or response-body disclosure", async () => {
  const { verifyPublicDeployment, FrontendCommitMismatch } = await import("./verify-deployment.mjs");
  for (const hash of ["f".repeat(12), "private-arbitrary-payload", null, 123, "a".repeat(40)]) {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      requests++;
      return String(input).endsWith("/version.json")
        ? globalThis.Response.json({ hash }) : originalFetch(input, init);
    };
    try {
      await assert.rejects(verifyPublicDeployment({ frontendUrl: origin, backendUrl: origin,
        sha, previousSha: "a".repeat(40), wait: assert.fail }), error => {
        assert.ok(error instanceof FrontendCommitMismatch);
        assert.equal(error.message.includes("private-arbitrary-payload"), false);
        return true;
      });
      assert.equal(requests, 6);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("previous-frontend retries share one deadline, including verification time", async () => {
  const { verifyPublicDeployment, FrontendCommitMismatch } = await import("./verify-deployment.mjs");
  let clock = 0;
  const deadlines = [];
  let calls = 0;
  await assert.rejects(verifyPublicDeployment({ frontendUrl: origin, backendUrl: origin,
    sha, previousSha: "a".repeat(40), now: () => clock,
    wait: async ms => { clock += ms; }, verify: async input => {
      deadlines.push(input.deadline);
      calls++;
      clock += 8500;
      throw new FrontendCommitMismatch(sha, "a".repeat(12));
    } }), /deadline exceeded/);
  assert.equal(clock, 20_000);
  assert.equal(calls, 2);
  assert.deepEqual(deadlines, [20_000, 20_000]);
});

test("a typed mismatch for another expected release is never propagation", async () => {
  const { verifyPublicDeployment, FrontendCommitMismatch } = await import("./verify-deployment.mjs");
  let calls = 0;
  await assert.rejects(verifyPublicDeployment({ frontendUrl: origin, backendUrl: origin,
    sha, previousSha: "a".repeat(40), wait: assert.fail, verify: async () => {
      calls++;
      throw new FrontendCommitMismatch("f".repeat(40), "a".repeat(12));
    } }), FrontendCommitMismatch);
  assert.equal(calls, 1);
});

test("persistent previous frontend exhausts exactly one twenty-second budget", async () => {
  const { verifyPublicDeployment, FrontendCommitMismatch } = await import("./verify-deployment.mjs");
  let clock = 0;
  let calls = 0;
  await assert.rejects(verifyPublicDeployment({ frontendUrl: origin, backendUrl: origin,
    sha, previousSha: "a".repeat(40), now: () => clock,
    wait: async ms => { assert.equal(ms, 2000); clock += ms; },
    verify: async ({ deadline }) => {
      calls++;
      assert.equal(deadline, 20_000);
      throw new FrontendCommitMismatch(sha, "a".repeat(12));
    } }), /deadline exceeded/);
  assert.equal(calls, 10);
  assert.equal(clock, 20_000);
});

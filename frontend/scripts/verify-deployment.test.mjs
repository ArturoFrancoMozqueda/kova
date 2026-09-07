import assert from "node:assert/strict";
import { createServer } from "node:http";
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

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { verifyDeployment } from "./verify-deployment.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";
let origin;
let server;

before(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/version.json") {
      response.end(JSON.stringify({ hash: sha.slice(0, 12) }));
    } else if (request.url === "/health") {
      response.end(JSON.stringify({ status: "ok", release_sha: sha }));
    } else if (request.url === "/health/db") {
      response.end(JSON.stringify({ status: "ok", db: "reachable" }));
    } else {
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
  const result = await verifyDeployment({ frontendUrl: origin, backendUrl: origin, sha });
  assert.equal(result.commit, sha);
  assert.equal(result.database, "reachable");
});

test("rejects a deployment from a different commit", async () => {
  await assert.rejects(
    verifyDeployment({ frontendUrl: origin, backendUrl: origin, sha: `f${sha.slice(1)}` }),
    /commit mismatch/,
  );
});

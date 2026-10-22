import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const patch = new URL("../patch-cf.mjs", import.meta.url);
const dist = new URL("../node_modules/cf/dist/", import.meta.url);
const moduleName = "deploy-context-ClNVJYlR.mjs";
const original = 'if(!t.ok)throw new z(e,t,`Generic Error`)';
const request = { method: "POST", url: "/registries/{domain}/credentials", path: { domain: "registry.cloudflare.com" } };
function check(source) {
  const start = source.indexOf('ot=/* @__PURE__ */ P(');
  const end = source.indexOf(',`catchErrorCodes`)', start);
  assert.ok(start >= 0 && end > start);
  return runInNewContext(source.slice(start + 3, end) + ')', {
    P: fn => fn,
    z: class extends Error { constructor(_request, _result, message) { super(message); } },
  });
}

test("registry failure diagnostics expose only validated numbers for the exact managed registry operation", () => {
  const source = readFileSync(new URL(moduleName, dist), "utf8");
  const patched = check(source);
  const secret = "synthetic-private-token-scope-push-pull";
  for (const status of [200, 429, 504]) {
    for (const code of [10001, secret, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      assert.throws(() => patched(request, { ok: false, status, body: { error: secret, code, password: secret } }), error => {
        assert.equal(error.message, `Registry credentials failed (HTTP ${status}; API code ${code === 10001 ? 10001 : "unknown"})`);
        assert.equal(error.message.includes(secret), false);
        return true;
      });
    }
  }
  for (const other of [{ ...request, method: "GET" }, { ...request, url: "/applications/{application_id}" },
    { ...request, path: { domain: "external.invalid" } }]) {
    assert.throws(() => patched(other, { ok: false, status: 429, body: { code: 10001 } }), { message: "Generic Error" });
  }
  // Preserve only the numeric code before upstream V4 normalization drops it.
  const parserStart = source.indexOf('nt=/* @__PURE__ */ P(');
  const parserEnd = source.indexOf(',`parseResponseSchemaV4`)', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parse = runInNewContext(source.slice(parserStart + 3, parserEnd) + ')', {
    P: fn => fn, qe: body => typeof body?.error === "string",
  });
  const normalized = parse("unused", { ok: true, status: 200, statusText: "OK" }, undefined,
    { success: false, errors: [{ code: 10001, message: secret }] });
  const buildStart = source.indexOf('ct=/* @__PURE__ */ P(');
  const buildEnd = source.indexOf(',`buildApiResult`)', buildStart);
  const build = runInNewContext(source.slice(buildStart + 3, buildEnd) + ')', { P: fn => fn, tt: () => true, nt: parse });
  const raw = { url: "unused", response: { ok: true, status: 200, statusText: "OK" },
    responseBody: { success: false, errors: [{ code: 10001, message: secret }] } };
  const result = build({}, request, raw);
  assert.deepEqual(result.body, normalized.body, "normalization body must remain untouched");
  assert.throws(() => patched(request, result), { message: "Registry credentials failed (HTTP 200; API code 10001)" });
  const otherRequest = { ...request, url: "/applications/{application_id}" };
  assert.equal(build({}, otherRequest, raw).kovaRegistryApiCode, undefined);
  for (const code of [secret, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = build({}, request, { ...raw, responseBody: { success: false, errors: [{ code, message: secret }] } });
    assert.throws(() => patched(request, invalid), { message: "Registry credentials failed (HTTP 200; API code unknown)" });
  }
  const successBody = { username: secret, password: secret };
  const success = build({}, request, { ...raw, responseBody: { success: true, result: successBody } });
  assert.equal(success.body, successBody);
  assert.equal(success.kovaRegistryApiCode, undefined);
  assert.doesNotThrow(() => patched(request, success));
  const retained = parse("unused", { ok: false, status: 429 }, undefined, { error: secret, code: 10001 });
  assert.throws(() => patched(request, retained), { message: "Registry credentials failed (HTTP 429; API code 10001)" });
  assert.doesNotThrow(() => patched(request, { ok: true, status: 200, body: { password: secret } }));
  assert.throws(() => patched(request, { ok: false, status: 403, body: { code: 10001 } }), { message: "Forbidden" });
  assert.throws(() => patched(request, { ok: false, status: secret, body: { code: 10001 } }), { message: "Registry credentials failed (HTTP 0; API code 10001)" });
});

test("all pinned patches validate before writing and registry diagnostics are idempotent", () => {
  const scratch = mkdtempSync(join(tmpdir(), "kova-cf-registry-patch-"));
  try {
    const target = join(scratch, "node_modules/cf/dist");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(scratch, "patch-cf.mjs"), readFileSync(patch));
    const originalContext = readFileSync(new URL(moduleName, dist), "utf8");
    const patchedStart = originalContext.indexOf('if(!t.ok){let n=e.method');
    const patchedEnd = originalContext.indexOf('},`catchErrorCodes`)', patchedStart);
    const catchBaseline = patchedStart < 0 ? originalContext : originalContext.slice(0, patchedStart) + original + originalContext.slice(patchedEnd);
    const buildStart = catchBaseline.indexOf('ct=/* @__PURE__ */ P(');
    const buildEnd = catchBaseline.indexOf(',`buildApiResult`)', buildStart) + ',`buildApiResult`)'.length;
    assert.ok(buildStart >= 0 && buildEnd > buildStart);
    const originalBuilder = 'ct=/* @__PURE__ */ P((e,t,n)=>tt(e,t)?nt(n.url,n.response,n.responseHeader,n.responseBody):{url:n.url,ok:n.response.ok,status:n.response.status,statusText:n.response.statusText,body:n.responseHeader??n.responseBody},`buildApiResult`)';
    const baseline = catchBaseline.slice(0, buildStart) + originalBuilder + catchBaseline.slice(buildEnd);
    const inputs = [
      ["deploy-input-fixture.mjs", 'm.push({name:`./${o}`,filePath:l'],
      ["dist-DZRTPMMA.mjs", 'script_name:t.script_name,environment:t.environment}]};break;case`d1`'],
      [moduleName, baseline],
    ];
    const script = join(scratch, "patch-cf.mjs");
    const packagePath = join(scratch, "node_modules/cf/package.json");
    const reset = () => { for (const [name, source] of inputs) writeFileSync(join(target, name), source); };
    writeFileSync(packagePath, JSON.stringify({ version: "1.0.0-beta.18" }));
    reset();
    execFileSync(process.execPath, [script], { stdio: "pipe" });
    const once = inputs.map(([name]) => readFileSync(join(target, name), "utf8"));
    assert.ok(once[2] !== baseline, "registry diagnostic patch must be applied");
    execFileSync(process.execPath, [script], { stdio: "pipe" });
    assert.deepEqual(inputs.map(([name]) => readFileSync(join(target, name), "utf8")), once);
    for (const [version, source] of [["1.0.0-beta.19", baseline], ["1.0.0-beta.18", "upstream changed"], ["1.0.0-beta.18", baseline.replace(originalBuilder, "changed builder")], ["1.0.0-beta.18", baseline + original], ["1.0.0-beta.18", once[2] + original]]) {
      reset();
      writeFileSync(packagePath, JSON.stringify({ version }));
      writeFileSync(join(target, moduleName), source);
      assert.throws(() => execFileSync(process.execPath, [script], { stdio: "pipe" }));
      assert.equal(readFileSync(join(target, inputs[0][0]), "utf8"), inputs[0][1], "must not partially apply earlier patches");
      assert.equal(readFileSync(join(target, moduleName), "utf8"), source);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

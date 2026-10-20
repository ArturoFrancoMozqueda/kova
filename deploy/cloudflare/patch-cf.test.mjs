import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = new URL("./node_modules/cf/dist/", import.meta.url);
const before = 'function xE(e,t){let n=SE(t),r=_E(DE(e,n),n);';
const after = 'function xE(e,t){let n=SE(t),i=DE(e,n);for(let e of[n,i])Array.isArray(e.routes)&&(e.routes=[...e.routes].sort((e,t)=>{let n=OE(e),r=OE(t);return n<r?-1:n>r?1:0}));let r=_E(i,n);';

test("real strict comparator ignores only route order and preserves upload inputs", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "kova-cf-route-comparison-"));
  const name = "containers-BtcOgwm5.mjs";
  const source = readFileSync(new URL(name, directory), "utf8");
  assert.equal(source.split(after).length - 1, 1);
  try {
    const variants = [];
    for (const patched of [false, true]) {
      const folder = join(scratch, patched ? "patched" : "original");
      mkdirSync(folder);
      symlinkSync(realpathSync(new URL("./node_modules", import.meta.url)), join(folder, "node_modules"));
      for (const filename of readdirSync(directory)) {
        const destination = join(folder, filename);
        if (filename === name) writeFileSync(destination,
          (patched ? source : source.replace(after, before)) + '\nexport { xE as compareForTest };\n');
        else symlinkSync(fileURLToPath(new URL(filename, directory)), destination);
      }
      variants.push((await import(pathToFileURL(join(folder, name)))).compareForTest);
    }
    const preview = { pattern: "preview.example.com", custom_domain: true, enabled: true, previews_enabled: false };
    const apex = { pattern: "example.com/*", zone_name: "example.com" };
    const www = { pattern: "www.example.com/*", zone_name: "example.com" };
    const local = { name: "frontend-test", workers_dev: false, preview_urls: false, routes: [preview, apex, www] };
    const remote = { ...structuredClone(local), routes: [apex, www, preview] };
    const originalInputs = structuredClone({ local, remote });
    assert.equal(variants[0](remote, local).nonDestructive, false, "reproduce the original false strict conflict");
    assert.equal(variants[1](remote, local).diff, null);
    assert.deepEqual({ local, remote }, originalInputs, "comparison must not mutate upload or remote configuration");
    const unicodeRoutes = [
      { pattern: "example.com/caf\u00e9/*" },
      { pattern: "example.com/cafe\u0301/*" },
    ];
    const unicodeLocal = { ...local, routes: unicodeRoutes };
    assert.equal(variants[1]({ ...local, routes: [...unicodeRoutes].reverse() }, unicodeLocal).diff, null);
    assert.notEqual(variants[1]({ ...local, routes: [unicodeRoutes[0], unicodeRoutes[0]] }, unicodeLocal).diff, null,
      "Unicode normalization must not merge distinct route descriptors");
    const check = routes => variants[1]({ ...remote, routes }, local);
    for (const [field, value] of [["pattern", "other.example.com"], ["custom_domain", false],
      ["enabled", false], ["previews_enabled", true], ["zone_id", "other-zone"],
      ["zone_name", "other.example.com"], ["future_field", true]]) {
      assert.equal(check([apex, www, { ...preview, [field]: value }]).nonDestructive, false, `${field} must still fail strict comparison`);
    }
    for (const routes of [[apex, www], [apex, www, preview, preview],
      [apex, www, preview, { pattern: "extra.example.com/*" }]]) {
      // Upstream permits some route additions. Preserve its policy while
      // ensuring the route multiset difference is never normalized away.
      assert.notEqual(check(routes).diff, null, "route removal/addition/duplicate must remain visible");
    }
    assert.equal(variants[1]({ ...remote, limits: { cpu_ms: 200 } }, local).nonDestructive, false);
    assert.equal(variants[1]({ ...remote, vars: { TENANT: "different" } }, local).nonDestructive, false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("route patch is idempotent and refuses package or comparator drift", () => {
  const patch = new URL("./patch-cf.mjs", import.meta.url);
  const actual = new URL("containers-BtcOgwm5.mjs", directory);
  const source = readFileSync(actual, "utf8");
  execFileSync(process.execPath, [fileURLToPath(patch)]);
  assert.equal(readFileSync(actual, "utf8"), source);
  const scratch = mkdtempSync(join(tmpdir(), "kova-cf-route-guard-"));
  try {
    const dist = join(scratch, "node_modules/cf/dist");
    mkdirSync(dist, { recursive: true });
    const script = join(scratch, "patch-cf.mjs");
    writeFileSync(script, readFileSync(patch, "utf8"));
    const comparator = join(dist, "containers-BtcOgwm5.mjs");
    for (const [version, input] of [["1.0.0-beta.19", before], ["1.0.0-beta.18", "unexpected"],
      ["1.0.0-beta.18", before + before], ["1.0.0-beta.18", before + after]]) {
      writeFileSync(join(scratch, "node_modules/cf/package.json"), JSON.stringify({ version }));
      writeFileSync(comparator, input);
      assert.throws(() => execFileSync(process.execPath, [script], { stdio: "pipe" }));
      assert.equal(readFileSync(comparator, "utf8"), input);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

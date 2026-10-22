import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = new URL("../node_modules/cf/dist/", import.meta.url);
const adapter = readdirSync(directory).find(name => /^deploy-input-.*\.mjs$/.test(name));
const { t: loadDeployment } = await import(new URL(adapter, directory));

test("Python upload paths remain visible to metadatafs and JavaScript paths stay relative", () => {
  const bundleDir = mkdtempSync(join(tmpdir(), "kova-python-packaging-"));
  try {
    mkdirSync(join(bundleDir, "python_modules/workers"), { recursive: true });
    const vendored = "python_modules/workers/__init__.py";
    writeFileSync(join(bundleDir, "entry.py"), "from workers import WorkerEntrypoint\n");
    writeFileSync(join(bundleDir, "entry.mjs"), "export default {}\n");
    writeFileSync(join(bundleDir, vendored), "# synthetic module\n");
    for (const type of ["python", "esm"]) {
      const mainModule = type === "python" ? "entry.py" : "entry.mjs";
      const deployment = loadDeployment({ bundleDir }, { manifest: { mainModule, modules: {
        [mainModule]: { type }, [vendored]: { type: "python" },
      } } });
      assert.equal(deployment.bundleType, type);
      assert.equal(deployment.modules[0].name, type === "python" ? vendored : `./${vendored}`);
    }
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }
});

test("pinned cf fixes are idempotent and both remain applied", () => {
  const patch = new URL("../patch-cf.mjs", import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(patch)]);
  const files = readdirSync(directory).filter(name => /^(deploy-input-|dist-).*\.mjs$/.test(name));
  const before = files.map(name => readFileSync(new URL(name, directory), "utf8"));
  execFileSync(process.execPath, [fileURLToPath(patch)]);
  assert.deepEqual(files.map(name => readFileSync(new URL(name, directory), "utf8")), before);
  assert.ok(before.some(source => source.includes('name:p===`python`?o:`./${o}`')));
  assert.ok(before.some(source => source.includes('...t.environment!==void 0?{environment:t.environment}:{}')));
});

test("real cf strict comparator accepts equivalent unset DO environment and R2 jurisdiction only", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "kova-cf-strict-diff-"));
  const before = 'script_name:t.script_name,environment:t.environment}]};break;case`d1`';
  const after = 'script_name:t.script_name,...t.environment!==void 0?{environment:t.environment}:{}}]};break;case`d1`';
  const r2Before = 'bucket_name:t.bucket_name,jurisdiction:t.jurisdiction}];break;case`secrets_store_secret`';
  const r2After = 'bucket_name:t.bucket_name,...t.jurisdiction!==void 0?{jurisdiction:t.jurisdiction}:{}}];break;case`secrets_store_secret`';
  const names = readdirSync(directory);
  const comparatorName = "containers-BtcOgwm5.mjs";
  const mapperName = "dist-DZRTPMMA.mjs";
  const mapper = readFileSync(new URL(mapperName, directory), "utf8");
  assert.equal(mapper.split(after).length - 1, 1);
  try {
    const variants = [];
    for (const patched of [false, true]) {
      const folder = join(scratch, patched ? "patched" : "original");
      mkdirSync(folder);
      symlinkSync(realpathSync(new URL("../node_modules", import.meta.url)), join(folder, "node_modules"));
      for (const name of names) {
        const destination = join(folder, name);
        if (name === mapperName) {
          const source = patched ? mapper : mapper.replace(after, before).replace(r2After, r2Before);
          writeFileSync(destination, source + '\nexport { fE as mapBindingsForTest };\n');
        } else if (name === comparatorName) {
          writeFileSync(destination, readFileSync(new URL(name, directory), "utf8") + '\nexport { xE as remoteDiffForTest };\n');
        } else symlinkSync(fileURLToPath(new URL(name, directory)), destination);
      }
      const { remoteDiffForTest } = await import(pathToFileURL(join(folder, comparatorName)));
      const { mapBindingsForTest } = await import(pathToFileURL(join(folder, mapperName)));
      variants.push({ remoteDiffForTest, mapBindingsForTest });
    }
    const descriptor = { type: "durable_object_namespace", name: "API", class_name: "KovaApi", script_name: "backend-test" };
    const local = { name: "gateway-test", workers_dev: false, preview_urls: false,
      durable_objects: { bindings: [{ name: "API", class_name: "KovaApi", script_name: "backend-test" }] } };
    const compare = (variant, binding = descriptor, changes = {}) => variant.remoteDiffForTest(
      { ...structuredClone(local), ...variant.mapBindingsForTest([binding]), ...changes }, local);
    assert.equal(compare(variants[0]).nonDestructive, false, "unpatched converter reproduces the destructive empty binding diff");
    assert.equal(compare(variants[1]).diff, null, "patched converter preserves an equivalent binding");
    assert.equal(compare(variants[1], { ...descriptor, environment: undefined }).diff, null);
    assert.equal(Object.hasOwn(variants[1].mapBindingsForTest([descriptor]).durable_objects.bindings[0], "environment"), false);
    for (const [field, value] of [["environment", null], ["environment", ""], ["environment", "production"],
      ["script_name", "other-tenant"], ["class_name", "OtherApi"], ["name", "OTHER"]]) {
      assert.equal(compare(variants[1], { ...descriptor, [field]: value }).nonDestructive, false, `${field} changes must still fail strict comparison`);
    }
    assert.equal(compare(variants[1], descriptor, { limits: { cpu_ms: 100 } }).nonDestructive, false);
    assert.equal(compare(variants[1], descriptor, { vars: { TENANT: "different" } }).nonDestructive, false);
    assert.equal(compare(variants[1], descriptor, { unsafe: { bindings: [{ type: "secret_text", name: "SYNTHETIC_SECRET" }] } }).nonDestructive, false);

    const r2 = { type: "r2_bucket", name: "ASSISTANT_STORAGE", bucket_name: "kova-assistant" };
    const r2Local = { name: "kova-backend", workers_dev: false, preview_urls: false,
      r2_buckets: [{ binding: r2.name, bucket_name: r2.bucket_name }] };
    const compareR2 = (variant, binding = r2) => variant.remoteDiffForTest(
      { ...structuredClone(r2Local), ...variant.mapBindingsForTest([binding]) }, r2Local);
    assert.equal(compareR2(variants[0]).nonDestructive, false,
      "real unpatched mapper reproduces the destructive empty R2 binding diff");
    assert.equal(compareR2(variants[1]).diff, null);
    assert.equal(compareR2(variants[1], { ...r2, jurisdiction: undefined }).diff, null);
    assert.equal(Object.hasOwn(variants[1].mapBindingsForTest([r2]).r2_buckets[0], "jurisdiction"), false);
    for (const [field, value] of [["jurisdiction", null], ["jurisdiction", ""],
      ["jurisdiction", "eu"], ["bucket_name", "another-bucket"], ["name", "OTHER_STORAGE"]]) {
      assert.equal(compareR2(variants[1], { ...r2, [field]: value }).nonDestructive, false,
        `${field} changes must still fail strict R2 comparison`);
    }
    const european = { ...r2Local, r2_buckets: [{ ...r2Local.r2_buckets[0], jurisdiction: "eu" }] };
    assert.equal(variants[1].remoteDiffForTest({ ...structuredClone(european),
      ...variants[1].mapBindingsForTest([{ ...r2, jurisdiction: "eu" }]) }, european).diff, null);

    // Dashboard saves omit the current Worker's name on its local namespaces.
    // Binding order is incidental; namespace identity and environment are not.
    const own = { name: "API", class_name: "KovaApi", script_name: "backend-test" };
    const external = { name: "JOBS", class_name: "KovaJobs", script_name: "jobs-test" };
    const native = { ...local, name: "backend-test", durable_objects: { bindings: [own, external] } };
    const dashboard = { ...native, durable_objects: { bindings: [external, { name: "API", class_name: "KovaApi" }] } };
    const remoteBefore = structuredClone(dashboard);
    assert.equal(variants[1].remoteDiffForTest(dashboard, native).diff, null);
    assert.deepEqual(dashboard, remoteBefore, "comparison must not mutate the remote metadata");
    for (const change of [{ script_name: "foreign-worker" }, { script_name: null },
      { class_name: "OtherApi" }, { name: "OTHER" }, { environment: "production" }]) {
      const remote = { ...dashboard, durable_objects: { bindings: [external, { name: "API", class_name: "KovaApi", ...change }] } };
      assert.equal(variants[1].remoteDiffForTest(remote, native).nonDestructive, false);
    }
    const missingExternalWorker = { ...dashboard, durable_objects: { bindings: [own, { name: "JOBS", class_name: "KovaJobs" }] } };
    assert.equal(variants[1].remoteDiffForTest(missingExternalWorker, native).nonDestructive, false);
    const previousSha = "a".repeat(40), targetSha = "b".repeat(40);
    const releaseLocal = { ...local, name: "kova-backend", vars: { KOVA_BUILD_SHA: targetSha, KEEP: "unchanged" } };
    const releaseRemote = { ...structuredClone(releaseLocal), vars: { KOVA_BUILD_SHA: previousSha, KEEP: "unchanged" } };
    const saved = [process.env.KOVA_NATIVE_PREVIOUS_SHA, process.env.KOVA_NATIVE_DEPLOY_SHA];
    try {
      delete process.env.KOVA_NATIVE_PREVIOUS_SHA;
      delete process.env.KOVA_NATIVE_DEPLOY_SHA;
      assert.equal(variants[1].remoteDiffForTest(releaseRemote, releaseLocal).nonDestructive, false);
      process.env.KOVA_NATIVE_PREVIOUS_SHA = previousSha;
      process.env.KOVA_NATIVE_DEPLOY_SHA = targetSha;
      assert.equal(variants[1].remoteDiffForTest(releaseRemote, releaseLocal).diff, null);
      assert.equal(releaseRemote.vars.KOVA_BUILD_SHA, previousSha);
      for (const remote of [
        { ...releaseRemote, vars: { ...releaseRemote.vars, KOVA_BUILD_SHA: "c".repeat(40) } },
        { ...releaseRemote, vars: { ...releaseRemote.vars, KEEP: "different" } },
      ]) assert.equal(variants[1].remoteDiffForTest(remote, releaseLocal).nonDestructive, false);
      // Upstream permits new variables; an absent identity must still appear
      // in the diff rather than being normalized as a captured transition.
      assert.notEqual(variants[1].remoteDiffForTest({ ...releaseRemote, vars: { KEEP: "unchanged" } }, releaseLocal).diff, null);
      assert.equal(variants[1].remoteDiffForTest(releaseRemote, { ...releaseLocal, name: "other-worker" }).nonDestructive, false);
      assert.equal(variants[1].remoteDiffForTest(releaseRemote, { ...releaseLocal, vars: { KOVA_BUILD_SHA: "d".repeat(40), KEEP: "unchanged" } }).nonDestructive, false);
      process.env.KOVA_NATIVE_PREVIOUS_SHA = "short";
      assert.equal(variants[1].remoteDiffForTest(releaseRemote, releaseLocal).nonDestructive, false);
    } finally {
      for (const [index, name] of ["KOVA_NATIVE_PREVIOUS_SHA", "KOVA_NATIVE_DEPLOY_SHA"].entries()) {
        if (saved[index] === undefined) delete process.env[name];
        else process.env[name] = saved[index];
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("pinned cf workaround refuses version, missing marker and duplicate drift before writing", () => {
  const scratch = mkdtempSync(join(tmpdir(), "kova-cf-patch-guard-"));
  try {
    const dist = join(scratch, "node_modules/cf/dist");
    mkdirSync(dist, { recursive: true });
    const patch = join(scratch, "patch-cf.mjs");
    writeFileSync(patch, readFileSync(new URL("../patch-cf.mjs", import.meta.url), "utf8"));
    const packageFile = join(scratch, "node_modules/cf/package.json");
    const adapterFile = join(dist, "deploy-input-test.mjs");
    const mapperFile = join(dist, "dist-DZRTPMMA.mjs");
    const adapter = 'm.push({name:`./${o}`,filePath:l';
    const mapper = 'script_name:t.script_name,environment:t.environment}]};break;case`d1`';
    for (const [version, adapterSource, mapperSource] of [
      ["1.0.0-beta.19", adapter, mapper],
      ["1.0.0-beta.18", adapter, "unexpected upstream source"],
      ["1.0.0-beta.18", adapter, mapper + mapper],
    ]) {
      writeFileSync(packageFile, JSON.stringify({ version }));
      writeFileSync(adapterFile, adapterSource);
      writeFileSync(mapperFile, mapperSource);
      assert.throws(() => execFileSync(process.execPath, [patch], { stdio: "pipe" }));
      assert.equal(readFileSync(adapterFile, "utf8"), adapterSource, "a failed second fix must not partially apply the first fix");
      assert.equal(readFileSync(mapperFile, "utf8"), mapperSource);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

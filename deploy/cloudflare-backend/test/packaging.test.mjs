import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

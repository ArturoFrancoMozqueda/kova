import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { resolve, posix } from "node:path";
import { cleanBuildOutputDir, getWorkerBundleDir, writeRootConfig,
  writeWorkerConfig, readBuildOutput } from "@cloudflare/build-output-utils";
import config, { jobs, gateway } from "./cloudflare.config.ts";

const root = import.meta.dirname;
const vendor = process.env.KOVA_WORKERS_PACKAGES;
if (!vendor) throw new Error("KOVA_WORKERS_PACKAGES must name the locked Pyodide site-packages directory");
await readFile(resolve(vendor, "workers/__init__.py"));
await cleanBuildOutputDir(root);
await writeRootConfig(root, {}, { isPreview: false });
const bundle = getWorkerBundleDir(root);
await mkdir(bundle, { recursive: true });
const modules = {
  "entry.py": { type: "python" },
  "platform-crypto.mjs": { type: "esm" },
};

async function copyTree(directory, prefix, { source = false } = {}) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (file.name === "__pycache__" || file.name.endsWith(".pyc")
        || file.name === "tests") continue;
    const name = posix.join(prefix, file.name);
    // S3 is Kova's only botocore service. Keep all S3 signing/endpoint data.
    if (prefix === "python_modules/botocore/data" && file.isDirectory()
        && file.name !== "s3") continue;
    if (file.isDirectory()) {
      await copyTree(resolve(directory, file.name), name, { source });
    } else {
      if (source && !file.name.endsWith(".py")) continue;
      await mkdir(resolve(bundle, posix.dirname(name)), { recursive: true });
      await cp(resolve(directory, file.name), resolve(bundle, name));
      modules[name] = { type: name.startsWith("python_modules/workers/")
        && /\.(js|mjs)$/.test(file.name) ? "esm" : "data" };
    }
  }
}

await copyTree(resolve(vendor), "python_modules");
await copyTree(resolve(root, "../../backend/app"), "python_modules/app", { source: true });
await cp(resolve(root, "entry.py"), resolve(bundle, "entry.py"));
await cp(resolve(root, "../../backend/app/workers/crypto.mjs"), resolve(bundle, "platform-crypto.mjs"));
modules["entry.py"] = { type: "python" };
modules["platform-crypto.mjs"] = { type: "esm" };
await writeWorkerConfig({ root, config: config.worker, manifest: {
  type: "complete", mainModule: "entry.py", modules,
} });
const jobBundle = getWorkerBundleDir(root, "jobs");
await cp(bundle, jobBundle, { recursive: true });
await cp(resolve(root, "jobs.py"), resolve(jobBundle, "entry.py"));
await writeWorkerConfig({ root, directoryName: "jobs", config: jobs.worker,
  manifest: { type: "complete", mainModule: "entry.py", modules } });
const publicBundle = getWorkerBundleDir(root, "gateway");
await mkdir(publicBundle, { recursive: true });
await cp(resolve(root, "gateway.mjs"), resolve(publicBundle, "gateway.mjs"));
await writeWorkerConfig({ root, directoryName: "gateway", config: gateway.worker,
  manifest: { type: "complete", mainModule: "gateway.mjs", modules: {
    "gateway.mjs": { type: "esm" },
  } } });
let total = 0;
for (const name of Object.keys(modules)) total += (await stat(resolve(bundle, name))).size;
if (total > 64 * 1024 * 1024) throw new Error("Python Worker exceeds the Free 64 MiB bundle limit");
await readBuildOutput(root);
console.log(`Packaged API and isolated jobs: ${(total / 1024 / 1024).toFixed(2)} MiB each; public gateway separately.`);

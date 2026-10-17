// Reuse the accepted frontend/proxy artifact under an isolated QA hostname.
import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = import.meta.dirname;
const frontend = resolve(root, "../cloudflare");
const result = spawnSync(process.execPath, [resolve(frontend, "build.mjs")], {
  cwd: frontend, stdio: "inherit", env: { ...process.env, KOVA_CLOUDFLARE_FRONTEND: "1" },
});
if (result.status !== 0) process.exit(result.status || 1);
const destination = resolve(root, ".cloudflare/frontend-candidate");
await mkdir(destination, { recursive: true });
await cp(resolve(frontend, ".cloudflare/output"), resolve(destination, ".cloudflare/output"), { recursive: true });
const worker = resolve(destination, ".cloudflare/output/v0/workers/default");
const path = resolve(worker, "worker.config.json");
const config = JSON.parse(await readFile(path, "utf8"));
if (config.name !== "kova-frontend") throw new Error("Expected the validated frontend artifact");
config.name = "kova-backend-preview";
config.domains = ["backend-preview.kovasuite.com"];
config.triggers = [];
await writeFile(path, JSON.stringify(config));
const source = await readFile(resolve(worker, "bundle/worker.mjs"), "utf8");
const origin = 'const API_ORIGIN = "https://api.kovasuite.com";';
if (source.split(origin).length !== 2) throw new Error("Unexpected API proxy configuration");
await writeFile(resolve(worker, "bundle/worker.mjs"), source.replace(origin,
  'const API_ORIGIN = "https://api-preview.kovasuite.com";'));
await writeFile(resolve(worker, "assets/_headers"),
  (await readFile(resolve(worker, "assets/_headers"), "utf8"))
    + "\nhttps://backend-preview.kovasuite.com/*\n  X-Robots-Tag: noindex, nofollow\n");
console.log("Isolated backend-preview frontend prepared; production Worker unchanged.");

// Prevent dependency lifecycle hooks from running before the verified backport.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyProject } from "./picomatch.mjs";

function npm(parameters, project) {
  const result = spawnSync("npm", [...parameters, "--prefix", project], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error("Verified npm installation failed");
}
export function installProject(project, { runNpm = npm, verify = verifyProject } = {}) {
  runNpm(["ci", "--ignore-scripts"], project);
  verify(project, { apply: true });
  runNpm(["rebuild", "--ignore-scripts=false", "--foreground-scripts"], project);
  return verify(project, { probe: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--project")) throw new Error("Usage: install.mjs [--project directory]");
    const project = resolve(args[1] ?? process.cwd());
    const report = installProject(project);
    console.log(JSON.stringify({ verifiedNpmProject: project, copies: report.copies.length, manifest: report.manifest_sha256 }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

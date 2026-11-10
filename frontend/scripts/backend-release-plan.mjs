import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const FULL_SHA = /^[a-f0-9]{40}$/i;
const root = fileURLToPath(new URL("../../", import.meta.url));
const ciFiles = new Set([
  "scripts/ci_policy.py", "scripts/tests/test_ci_policy.py",
  "scripts/tests/test_ci_cost_workflows.py",
]);
const frontendScripts = new Set([
  "backend-release-plan", "capture-cloudflare", "capture-showcase", "check-bundle-secrets",
  "check-e2e-imports", "check-openapi-contract", "cloudflare-provider",
  "complete-stripe-test-checkout", "complete-stripe-test-portal", "optimize-og", "prerender",
  "readiness-fetch", "release-billing-offer", "release-recovery", "release",
  "stripe-test-checkout-fields", "verify-deployment",
].flatMap(name => [`frontend/scripts/${name}.mjs`, `frontend/scripts/${name}.test.mjs`]));

export function backendUnchanged(paths) {
  // A closed allowlist, relative to the ACTUALLY deployed backend, not the
  // previous commit/PR. Renames must include both deleted and added paths.
  return Array.isArray(paths) && paths.length > 0 && paths.every(path =>
    typeof path === "string" && !path.includes("\0") && !path.split("/").includes("..") && (
      (path.startsWith("frontend/") && !path.startsWith("frontend/scripts/"))
      || frontendScripts.has(path)
      || path.startsWith("frontend/scripts/film/")
      || (path.startsWith("deploy/cloudflare/") && !path.includes("/../"))
      || ((path.startsWith("docs/") || ["README.md", "CHANGELOG.md", "CLAUDE.md"].includes(path))
        && path.endsWith(".md"))
      || ciFiles.has(path)
    ));
}

export function backendReleasePlan({ sha, previousSha,
  eventName = process.env.GITHUB_EVENT_NAME, cwd = root,
  git = args => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
}) {
  if (![sha, previousSha].every(value => FULL_SHA.test(value ?? ""))) {
    throw new Error("Backend publication planning requires complete release SHAs");
  }
  const full = { publishBackend: true, backendSha: sha };
  if (git(["rev-parse", "HEAD"]).trim() !== sha) {
    throw new Error("Publication source does not match the reviewed release SHA");
  }
  try { git(["diff", "--quiet", "HEAD", "--"]); }
  catch { throw new Error("Publication requires an unchanged reviewed source tree"); }
  // Manual publication remains explicit and complete. Startup configuration
  // changes still require a new reviewed SHA under the existing boot policy.
  if (eventName !== "push") return full;
  let paths;
  try {
    paths = git(["diff", "--name-only", "--no-renames", "-z", previousSha, sha, "--"])
      .split("\0").filter(Boolean);
  } catch {
    // Shallow/missing baseline or any uncertainty retains full publication.
    return full;
  }
  return backendUnchanged(paths)
    ? { publishBackend: false, backendSha: previousSha } : full;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
  const plan = backendReleasePlan({ sha: arg("sha"), previousSha: arg("previous-sha") });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `publish_backend=${plan.publishBackend}\nbackend_sha=${plan.backendSha}\n`);
  console.log(JSON.stringify(plan));
}

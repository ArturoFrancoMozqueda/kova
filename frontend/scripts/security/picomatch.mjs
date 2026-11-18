// Verified local backport. Registry identities and advisory reports stay intact.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const sourceDirectory = fileURLToPath(new URL("./picomatch/", import.meta.url));
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export function loadManifest(directory = sourceDirectory, now = Date.now()) {
  directory = realpathSync(directory);
  const raw = readFileSync(join(directory, "manifest.json"));
  const manifest = JSON.parse(raw);
  if (manifest.advisory !== "GHSA-fc5q-39xc-vjpf" ||
      !manifest.review?.owner || manifest.review.status !== "verified" ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(manifest.review.reviewedAt ?? "") ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(manifest.review.expiresAt ?? "") ||
      !Number.isFinite(Date.parse(manifest.review.expiresAt)) ||
      !manifest.review.evidence ||
      !Number.isFinite(Date.parse(manifest.review.reviewedAt)) ||
      Date.parse(manifest.review.reviewedAt) > now ||
      Date.parse(manifest.review.expiresAt) <= Date.parse(manifest.review.reviewedAt) ||
      Date.parse(manifest.review.expiresAt) - Date.parse(manifest.review.reviewedAt) > 7 * 24 * 60 * 60 * 1000 ||
      now >= Date.parse(manifest.review.expiresAt)) {
    throw new Error("Picomatch backport review is missing, expired or unverified");
  }
  return { manifest, digest: sha256(raw), directory };
}

function inside(parent, child) {
  const part = relative(parent, child);
  return part !== ".." && !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(part);
}
function regularFile(root, name) {
  if (!name || name.split(/[\\/]/).some(part => !part || part === "." || part === "..")) throw new Error("Unsafe backport file path");
  const path = resolve(root, name);
  if (!inside(root, path) || !lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error("Backport runtime file must be a regular in-scope file");
  return path;
}
function runtimeFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("Symlink in picomatch distribution");
    if (entry.isDirectory()) return runtimeFiles(join(directory, entry.name), name);
    return /\.(?:[cm]?js|json)$/.test(name) ? [name] : [];
  }).sort();
}
function installedCopies(modules) {
  const copies = [];
  for (const item of readdirSync(modules, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const path = join(modules, item.name);
    if (item.name === "picomatch") {
      if (item.isSymbolicLink() || !item.isDirectory()) throw new Error("Linked picomatch installation is not reviewed");
      copies.push(realpathSync(path));
    }
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    if (item.name.startsWith("@")) copies.push(...installedCopies(path));
    else {
      const nested = join(path, "node_modules");
      try { if (lstatSync(nested).isDirectory()) copies.push(...installedCopies(nested)); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  return copies;
}

export function verifyCopy(directory, version, review, { apply = false, probe = false } = {}) {
  const release = review.manifest.releases[version];
  if (!release) throw new Error(`Unreviewed picomatch version ${version}`);
  const root = realpathSync(directory);
  const info = JSON.parse(readFileSync(regularFile(root, "package.json"), "utf8"));
  if (info.name !== "picomatch" || info.version !== version) throw new Error("Picomatch registry identity changed");
  const names = Object.keys(release.files).sort();
  if (JSON.stringify(runtimeFiles(root)) !== JSON.stringify(names)) throw new Error("Picomatch executable inventory changed");
  const observed = {};
  // Validate every preimage before writing any file; only parse.js may change.
  for (const name of names) {
    const pin = release.files[name];
    const hash = sha256(readFileSync(regularFile(root, name)));
    if (!/^[a-f0-9]{64}$/.test(pin.before) || !/^[a-f0-9]{64}$/.test(pin.after) ||
        (name !== "lib/parse.js" && pin.before !== pin.after) ||
        (hash !== pin.after && (!apply || hash !== pin.before))) {
      throw new Error(`Unverified picomatch runtime bytes: ${version}/${name}`);
    }
    observed[name] = hash;
  }
  if (apply && observed["lib/parse.js"] !== release.files["lib/parse.js"].after) {
    const replacement = readFileSync(regularFile(review.directory, release.replacement));
    if (sha256(replacement) !== release.files["lib/parse.js"].after) throw new Error("Backport replacement hash mismatch");
    const destination = regularFile(root, "lib/parse.js");
    const temporary = `${destination}.kova-backport-tmp`;
    writeFileSync(temporary, replacement, { flag: "wx" });
    renameSync(temporary, destination);
    observed["lib/parse.js"] = sha256(readFileSync(destination));
  }
  let regression = null;
  if (probe) {
    const runner = new URL("./picomatch-regressions.mjs", import.meta.url);
    if (sha256(readFileSync(runner)) !== review.manifest.regressions.sha256) throw new Error("Regression runner hash mismatch");
    const check = spawnSync(process.execPath, ["--max-old-space-size=128", fileURLToPath(runner), root], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" }, encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576,
    });
    if (check.error || check.status !== 0) throw new Error(`Picomatch isolated regressions failed: ${version}`);
    regression = JSON.parse(check.stdout);
    if (regression.status !== "passed" || regression.cases !== review.manifest.regressions.cases[version] || regression.packageVersion !== version) throw new Error("Incomplete picomatch regression evidence");
  }
  return { version, files: observed, regression };
}

export function verifyProject(project, { apply = false, probe = false, review } = {}) {
  const root = realpathSync(project);
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error("Unreviewed npm lock format");
  const expected = Object.entries(lock.packages).filter(([name]) => /(?:^|\/)node_modules\/picomatch$/.test(name));
  review ??= expected.length ? loadManifest() : null;
  const copies = [];
  const addresses = [];
  for (const [path, entry] of expected) {
    if (!/^node_modules\/(?:[^.\\/][^\\/]*\/)*picomatch$/.test(path)) throw new Error("Unsafe picomatch lock location");
    const release = review.manifest.releases[entry.version];
    if (!release || entry.integrity !== release.integrity || entry.resolved !== release.tarball || entry.link) throw new Error("Unreviewed picomatch registry source");
    const installed = resolve(root, path);
    if (!inside(root, installed) || realpathSync(installed) !== installed) throw new Error("Picomatch installation escaped its project");
    addresses.push(installed);
    copies.push({ path, ...verifyCopy(installed, entry.version, review, { apply, probe }) });
  }
  const actual = installedCopies(join(root, "node_modules")).sort();
  if (JSON.stringify(actual) !== JSON.stringify(addresses.sort())) throw new Error("Installed picomatch copies differ from the lock inventory");
  return { protocol: "kova-picomatch-backport-v1", manifest_sha256: review?.digest ?? null, advisory: review?.manifest.advisory ?? null, copies };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const allowed = new Set(["--apply", "--verify", "--probe", "--project", "--copy", "--version"]);
    let project = process.cwd(); let copy; let version;
    for (let index = 0; index < args.length; index++) {
      if (!allowed.has(args[index])) throw new Error("Unknown picomatch verifier option");
      if (args[index] === "--project") project = resolve(args[++index]);
      else if (args[index] === "--copy") copy = resolve(args[++index]);
      else if (args[index] === "--version") version = args[++index];
    }
    const options = { apply: args.includes("--apply"), probe: args.includes("--probe") };
    const review = copy ? loadManifest() : undefined;
    const result = copy ? { protocol: "kova-picomatch-backport-v1", manifest_sha256: review.digest,
      advisory: review.manifest.advisory, copies: [verifyCopy(copy, version, review, options)] }
      : verifyProject(project, { ...options, review });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

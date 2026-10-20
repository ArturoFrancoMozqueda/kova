// cf beta.18 prefixes prebuilt module names with "./". Python metadatafs
// treats that as a literal directory named ".", making vendor files invisible.
// Keep canonical paths for Python bundles; preserve JavaScript behavior.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const directory = new URL("./node_modules/cf/dist/", import.meta.url);
const packageInfo = JSON.parse(readFileSync(new URL("../package.json", directory), "utf8"));
if (packageInfo.version !== "1.0.0-beta.18") throw new Error("Revalidate the cf Python packaging workaround before updating CLI");
function prepareFix(filename, before, after, description) {
  const files = readdirSync(directory).filter(name => filename.test(name));
  if (files.length !== 1) throw new Error(`Unexpected cf ${description} module`);
  const file = new URL(files[0], directory);
  const source = readFileSync(file, "utf8");
  const originalCount = source.split(before).length - 1;
  const patchedCount = source.split(after).length - 1;
  if (originalCount === 0 && patchedCount === 1) return { file, source, changed: false };
  if (originalCount !== 1 || patchedCount !== 0) throw new Error(`Unexpected cf ${description}; refusing an unverified patch`);
  return { file, source: source.replace(before, after), changed: true };
}

// Dashboard metadata omits an unset DO environment. The remote converter adds
// an own undefined property, which json-diff treats as a destructive [{}]
// binding change against the otherwise identical local descriptor. Omit only
// that undefined field; explicit environments and every strict check remain.
const fixes = [
  prepareFix(/^deploy-input-.*\.mjs$/,
    'm.push({name:`./${o}`,filePath:l',
    'm.push({name:p===`python`?o:`./${o}`,filePath:l', "Python module naming"),
  prepareFix(/^dist-DZRTPMMA\.mjs$/,
    'script_name:t.script_name,environment:t.environment}]};break;case`d1`',
    'script_name:t.script_name,...t.environment!==void 0?{environment:t.environment}:{}}]};break;case`d1`', "remote DO environment"),
];
for (const fix of fixes) if (fix.changed) writeFileSync(fix.file, fix.source);
if (fixes.some(fix => fix.changed)) console.log("Applied pinned cf Python packaging and remote DO metadata compatibility fixes.");

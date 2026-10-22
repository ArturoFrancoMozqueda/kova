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
  let source = readFileSync(file, "utf8");
  let changed = false;
  const originals = Array.isArray(before) ? before : [before];
  const replacements = Array.isArray(after) ? after : [after];
  for (const [index, original] of originals.entries()) {
    const replacement = replacements[index];
    const originalCount = source.split(original).length - 1;
    const patchedCount = source.split(replacement).length - 1;
    if (originalCount === 0 && patchedCount === 1) continue;
    if (originalCount !== 1 || patchedCount !== 0) throw new Error(`Unexpected cf ${description}; refusing an unverified patch`);
    source = source.replace(original, replacement);
    changed = true;
  }
  return { file, source, changed };
}

// Dashboard metadata omits an unset DO environment. The remote converter adds
// an own undefined property, which json-diff treats as a destructive [{}]
// binding change against the otherwise identical local descriptor. Omit only
// that undefined field; explicit environments and every strict check remain.
const fixes = [
  // Dashboard uploads omit script_name for this Worker's own DO namespaces.
  // Normalize only that equivalent representation before the strict diff;
  // explicit foreign workers, classes and environments still fail closed.
  prepareFix(/^containers-BtcOgwm5\.mjs$/,
    'function xE(e,t){let n=SE(t),r=_E(DE(e,n),n);',
    'function xE(e,t){let n=SE(t);e=structuredClone(e);for(let r of e.durable_objects?.bindings??[])if(r.script_name===void 0&&n.durable_objects?.bindings?.some(t=>t.name===r.name&&t.class_name===r.class_name&&t.script_name===n.name))r.script_name=n.name;let r=_E(DE(e,n),n);', "same-worker DO metadata"),
  // The generated registry client discards the useful HTTP status in its
  // generic error message. Preserve failure behavior and expose only numeric
  // diagnostics for the managed registry credential operation, never its body.
  prepareFix(/^deploy-context-ClNVJYlR\.mjs$/,
    [
      'if(!t.ok)throw new z(e,t,`Generic Error`)',
      'ct=/* @__PURE__ */ P((e,t,n)=>tt(e,t)?nt(n.url,n.response,n.responseHeader,n.responseBody):{url:n.url,ok:n.response.ok,status:n.response.status,statusText:n.response.statusText,body:n.responseHeader??n.responseBody},`buildApiResult`)',
    ],
    [
      'if(!t.ok){let n=e.method===`POST`&&e.url===`/registries/{domain}/credentials`&&e.path?.domain===`registry.cloudflare.com`,r=Number.isInteger(t.status)&&t.status>=100&&t.status<=599?t.status:0,i=t.kovaRegistryApiCode??t.body?.code;throw new z(e,t,n?`Registry credentials failed (HTTP ${r}; API code ${Number.isSafeInteger(i)&&i>=0?i:`unknown`})`:`Generic Error`)}',
      'ct=/* @__PURE__ */ P((e,t,n)=>{let r=tt(e,t)?nt(n.url,n.response,n.responseHeader,n.responseBody):{url:n.url,ok:n.response.ok,status:n.response.status,statusText:n.response.statusText,body:n.responseHeader??n.responseBody};if(!r.ok&&t.method===`POST`&&t.url===`/registries/{domain}/credentials`&&t.path?.domain===`registry.cloudflare.com`){let e=n.responseBody?.errors?.[0]?.code;Number.isSafeInteger(e)&&e>=0&&(r.kovaRegistryApiCode=e)}return r},`buildApiResult`)',
    ], "registry credential diagnostics"),
  prepareFix(/^deploy-input-.*\.mjs$/,
    'm.push({name:`./${o}`,filePath:l',
    'm.push({name:p===`python`?o:`./${o}`,filePath:l', "Python module naming"),
  prepareFix(/^dist-DZRTPMMA\.mjs$/,
    'script_name:t.script_name,environment:t.environment}]};break;case`d1`',
    'script_name:t.script_name,...t.environment!==void 0?{environment:t.environment}:{}}]};break;case`d1`', "remote DO environment"),
];
for (const fix of fixes) if (fix.changed) writeFileSync(fix.file, fix.source);
if (fixes.some(fix => fix.changed)) console.log("Applied pinned cf compatibility and safe registry diagnostic fixes.");

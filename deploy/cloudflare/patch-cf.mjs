import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const directory = new URL("./node_modules/cf/dist/", import.meta.url);
const packageInfo = JSON.parse(readFileSync(new URL("../package.json", directory), "utf8"));
if (packageInfo.version !== "1.0.0-beta.18") throw new Error("Revalidate the cf route comparison workaround before updating CLI");
const files = readdirSync(directory).filter(name => name === "containers-BtcOgwm5.mjs");
if (files.length !== 1) throw new Error("Unexpected cf route comparison module");
const file = new URL(files[0], directory);
const source = readFileSync(file, "utf8");
const before = 'function xE(e,t){let n=SE(t),r=_E(DE(e,n),n);';
// Workers Routes match by specificity, and Custom Domains by exact hostname.
// Compare route arrays as multisets of complete descriptors in cloned configs.
// Preserve duplicates and all fields; never reorder the upload configuration.
// https://developers.cloudflare.com/workers/configuration/routing/routes/
// https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
const after = 'function xE(e,t){let n=SE(t),i=DE(e,n);for(let e of[n,i])Array.isArray(e.routes)&&(e.routes=[...e.routes].sort((e,t)=>{let n=OE(e),r=OE(t);return n<r?-1:n>r?1:0}));let r=_E(i,n);';
const originalCount = source.split(before).length - 1;
const patchedCount = source.split(after).length - 1;
if (!(originalCount === 0 && patchedCount === 1)) {
  if (originalCount !== 1 || patchedCount !== 0) throw new Error("Unexpected cf route comparator; refusing an unverified patch");
  writeFileSync(file, source.replace(before, after));
  console.log("Applied pinned cf route order comparison compatibility fix.");
}

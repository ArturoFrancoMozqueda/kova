// cf beta.18 prefixes prebuilt module names with "./". Python metadatafs
// treats that as a literal directory named ".", making vendor files invisible.
// Keep canonical paths for Python bundles; preserve JavaScript behavior.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const directory = new URL("./node_modules/cf/dist/", import.meta.url);
const packageInfo = JSON.parse(readFileSync(new URL("../package.json", directory), "utf8"));
if (packageInfo.version !== "1.0.0-beta.18") throw new Error("Revalidate the cf Python packaging workaround before updating CLI");
const files = readdirSync(directory).filter(name => /^deploy-input-.*\.mjs$/.test(name));
if (files.length !== 1) throw new Error("Unexpected cf deployment adapter");
const file = new URL(files[0], directory);
const source = readFileSync(file, "utf8");
const before = 'm.push({name:`./${o}`,filePath:l';
const after = 'm.push({name:p===`python`?o:`./${o}`,filePath:l';
if (source.includes(after)) process.exit(0);
if (source.split(before).length !== 2) throw new Error("Unexpected cf module naming; refusing an unverified patch");
writeFileSync(file, source.replace(before, after));
console.log("Applied pinned cf Python prebuilt path compatibility fix.");

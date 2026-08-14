import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const e2eDir = path.resolve("e2e");
const files = (await readdir(e2eDir)).filter((name) => name.endsWith(".spec.ts"));
const invalid = [];

for (const file of files) {
  const source = await readFile(path.join(e2eDir, file), "utf8");
  if (source.includes('from "@playwright/test"')) invalid.push(file);
}

if (invalid.length > 0) {
  throw new Error(
    `E2E specs must import the API request guard from ./fixtures: ${invalid.join(", ")}`,
  );
}

console.log(`e2e-mocked import guard: ${files.length} specs checked`);

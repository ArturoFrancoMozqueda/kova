/**
 * Post-build security gate: scans compiled JS assets for patterns that indicate
 * a server-only secret was accidentally embedded in the browser bundle.
 *
 * Run after `npm run build`. Exits non-zero on any match so CI fails fast.
 */

import { readFileSync, readdirSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist", "assets");

const FORBIDDEN = [
  // Stripe
  "sk_live_",
  "sk_test_",
  "whsec_",
  // Supabase / generic service-role
  "service_role",
  "SUPABASE_SERVICE",
  // Resend
  "RESEND_API_KEY",
  "re_live_",
  "re_test_",
  // Internal Kova secrets
  "STRIPE_SECRET",
  "SECRET_KEY",
  "DATABASE_URL",
  "INTERNAL_API_KEY",
  // Hardcoded JWT (base64 header for HS256)
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
];

let files;
try {
  files = readdirSync(DIST_DIR).filter((f) => extname(f) === ".js");
} catch {
  console.error(`[check-bundle-secrets] dist/assets not found — run 'npm run build' first.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error("[check-bundle-secrets] No JS files found in dist/assets.");
  process.exit(1);
}

const hits = [];
for (const file of files) {
  const content = readFileSync(join(DIST_DIR, file), "utf8");
  for (const pattern of FORBIDDEN) {
    if (content.includes(pattern)) {
      hits.push(`  ${file} → "${pattern}"`);
    }
  }
}

if (hits.length > 0) {
  console.error("[check-bundle-secrets] FAIL — forbidden patterns found in bundle:");
  hits.forEach((h) => console.error(h));
  process.exit(1);
}

console.log(`[check-bundle-secrets] OK — ${files.length} JS file(s) scanned, no forbidden patterns found.`);

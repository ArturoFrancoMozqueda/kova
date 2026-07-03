// @vitest-environment node
import { describe, expect, it } from "vitest";

// Guards against accidentally pulling a backend-only secret into the client
// bundle. Vite only exposes `import.meta.env` vars prefixed with VITE_ (plus a
// handful of built-ins), so anything else here would be undefined at runtime —
// but a hardcoded secret literal would still ship. This test fails the build
// before that can happen.
//
// Source files are loaded as raw strings via Vite's import.meta.glob (no Node
// `fs` — this project's tsconfig is browser-only).

const rawModules = import.meta.glob("../**/*.{ts,tsx,js,jsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Exclude test files (this one references the forbidden patterns deliberately).
const sources = Object.entries(rawModules).filter(
  ([file]) => !/\.test\.(ts|tsx|js|jsx)$/.test(file),
);

// Vite built-in env vars that are safe and not VITE_-prefixed.
const VITE_BUILTINS = new Set(["MODE", "DEV", "PROD", "SSR", "BASE_URL"]);

// Substrings that should never appear in client source (real or templated secrets).
const FORBIDDEN_SUBSTRINGS = [
  // Supabase
  "service_role",
  "SUPABASE_SERVICE",
  // Stripe
  "sk_live_",
  "sk_test_",
  "STRIPE_SECRET",
  "whsec_",
  // Resend
  "RESEND_API_KEY",
  "re_live_",
  "re_test_",
  // Internal Kova server-only config
  "DATABASE_URL",
  "SECRET_KEY",
  "INTERNAL_API_KEY",
  // Hardcoded JWT (HS256 base64 header prefix)
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
];

describe("frontend secret exposure guard", () => {
  it("finds source files to scan", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("only references VITE_-prefixed (or built-in) import.meta.env vars", () => {
    const offenders: string[] = [];
    const envRef = /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
    for (const [file, content] of sources) {
      for (const match of content.matchAll(envRef)) {
        const name = match[1];
        if (name.startsWith("VITE_") || VITE_BUILTINS.has(name)) continue;
        offenders.push(`${file} → import.meta.env.${name}`);
      }
    }
    expect(offenders, `Non-public env vars in client bundle:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("contains no hardcoded backend secret patterns", () => {
    const offenders: string[] = [];
    for (const [file, content] of sources) {
      for (const needle of FORBIDDEN_SUBSTRINGS) {
        if (content.includes(needle)) {
          offenders.push(`${file} → "${needle}"`);
        }
      }
    }
    expect(offenders, `Forbidden secret patterns found:\n${offenders.join("\n")}`).toEqual([]);
  });
});

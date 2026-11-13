// @vitest-environment node
import { describe, expect, it } from "vitest";

// Guards against state-changing `fetch` calls that forget the CSRF header.
// The backend CSRF middleware (`backend/app/middleware/csrf.py`) answers 403 to
// any cookie-authenticated POST/PUT/PATCH/DELETE without `X-CSRF-Token`, and
// the global fetch interceptor does not add it. Every fetch that may send an
// unsafe method must therefore either:
//   - live in a module that uses `csrfHeaders` from `@/lib/csrf`, or
//   - opt out of cookies with `credentials: "omit"` (public, unauthenticated
//     routes: the middleware only enforces CSRF when auth cookies are sent).
// Anything else needs an allowlist entry with a justification.
//
// Source files are loaded as raw strings via Vite's import.meta.glob (no Node
// `fs` — this project's tsconfig is browser-only).

const rawModules = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const sources = Object.entries(rawModules).filter(
  ([file]) => !/\.(test|spec)\.(ts|tsx)$/.test(file) && !file.includes("/__tests__/") && !file.includes("/test/"),
);

/** Files allowed to send unsafe-method fetches without `csrfHeaders`. */
const ALLOWLIST: Record<string, string> = {
  // (empty) Add `"../path/file.ts": "why CSRF does not apply"` only when the
  // request can never carry Kova auth cookies or the path is exempt in
  // backend/app/middleware/csrf.py (_EXEMPT_PATHS).
};

const SAFE_METHOD_VALUE = /^\s*["'`](GET|HEAD|OPTIONS)["'`]\s*$/i;

/** Returns the argument text of every `fetch(` call in `source`. */
function fetchCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /(?<![\w$.])(?:window\.|globalThis\.|self\.)?fetch\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      index += 1;
    }
    calls.push(source.slice(start, index - 1));
  }
  return calls;
}

/** Splits `fetch(url, init)` arguments at the first top-level comma. */
function initArgument(args: string): string | null {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      const rest = args.slice(i + 1).trim();
      return rest.length > 0 ? rest : null;
    }
  }
  return null;
}

/** A call may be unsafe unless its init is absent or pins a safe method. */
function mayUseUnsafeMethod(args: string): boolean {
  const init = initArgument(args);
  if (!init) return false;
  if (!init.startsWith("{")) return true; // init forwarded from a caller
  const methodMatch = /\bmethod\s*:\s*([^,\n}]+)/.exec(init);
  if (methodMatch) return !SAFE_METHOD_VALUE.test(methodMatch[1]);
  // `{ method, ... }` shorthand or a spread init may carry any method.
  return /(?:[{,]\s*method\s*[,}])|\.\.\./.test(init);
}

describe("frontend CSRF fetch guard", () => {
  it("finds source files with fetch calls to scan", () => {
    expect(sources.filter(([, source]) => fetchCalls(source).length > 0).length).toBeGreaterThan(10);
  });

  it("classifies fetch calls by method", () => {
    expect(mayUseUnsafeMethod(`"/api/v1/x"`)).toBe(false);
    expect(mayUseUnsafeMethod(`"/api/v1/x", { signal }`)).toBe(false);
    expect(mayUseUnsafeMethod(`"/api/v1/x", { method: "GET" }`)).toBe(false);
    expect(mayUseUnsafeMethod(`"/api/v1/x", { method: "POST" }`)).toBe(true);
    expect(mayUseUnsafeMethod(`url, init`)).toBe(true);
    expect(mayUseUnsafeMethod(`url, { ...init, headers }`)).toBe(true);
    expect(mayUseUnsafeMethod(`url, { method, body }`)).toBe(true);
  });

  it("sends X-CSRF-Token on every cookie-authenticated unsafe fetch", () => {
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      if (file in ALLOWLIST) continue;
      const usesCsrfHelper = /\bcsrfHeaders\s*\(/.test(source);
      for (const args of fetchCalls(source)) {
        if (!mayUseUnsafeMethod(args)) continue;
        if (usesCsrfHelper) continue;
        if (/credentials\s*:\s*["'`]omit["'`]/.test(args)) continue;
        offenders.push(`${file}: fetch(${args.slice(0, 80).replace(/\s+/g, " ")}…)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

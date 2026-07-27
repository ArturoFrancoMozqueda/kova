// Minimal ambient shims for the Node built-ins used by tests that read repo
// files (currently only src/lib/motion.test.ts, which parses styles.css to prove
// MOTION_MS has not drifted from the --kova-dur-* tokens).
//
// Deliberately not `npm i -D @types/node` + `"types": ["node"]`: that would put
// Node globals (process, Buffer, setTimeout's Node overloads, require) in scope
// for application code, where they would mask real browser mistakes.
//
// Vite's `?raw` is not an option here — Vitest runs with `css: false`, so a
// `styles.css?raw` import resolves to an empty string.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}

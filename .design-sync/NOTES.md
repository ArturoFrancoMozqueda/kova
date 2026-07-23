# design-sync notes — Kova POS (pos-frontend)

## Repo shape

- App repo, not a packaged library: no `dist/`, no Storybook. The bundle entry is
  the committed barrel `frontend/ds-entry.ts`; component list is pinned
  explicitly in `componentSrcMap` (discovery would otherwise sweep the whole app).
- `.d.ts` contracts come from a tsc declaration emit: `frontend/tsconfig.dssync.json`
  → `frontend/types/` (gitignored; `findTypesRoot` picks the `types/` dir up
  automatically). Re-run it before every converter build (it's in `buildCmd`).
- Compiled CSS comes from the Tailwind CLI with `.design-sync/tailwind.dssync.config.js`
  (extends the app config, adds a curated safelist so the shipped CSS carries the
  Kova utility vocabulary + preview-only classes). Output: `frontend/.ds-css/compiled.css`.
  Re-run whenever previews change (also in `buildCmd`).
- Fonts: Inter Variable ships from `@fontsource-variable/inter`; plain "Inter"
  (fallback name in the font stack) is aliased to the same woff2s via
  `.design-sync/inter-alias.css` (extraFonts). Bricolage Grotesque is landing-only
  and out of scope.
- `provider: MemoryRouter` (exported from the barrel) — `ViewPermissionDenied`/`ViewEmpty`
  render react-router `<Link>`s.

## Preview gotchas (learned during first sync)

- **Overlay components (Dialog/ConfirmDialog)**: previews wrap them in a
  `style={{transform:"translateZ(0)", height:…, overflow:"hidden"}}` div so the
  `fixed inset-0` overlay positions against the wrapper, not the viewport.
  They also inject `<style>[role=presentation] * { animation: none !important }</style>`
  — the entry animations (fade/scale) start at opacity 0 and race the capture
  screenshot (blank PNGs otherwise). Keep both tricks on any new overlay preview.
- **RouteFallback**: `min-h-screen` is clamped via a scoped `<style>` override in
  the preview so the centered spinner is visible in the cell.
- **ToastProvider**: preview fires toasts from `useToast()` in a mount `useEffect`
  with `durationMs: 60000` so the capture catches them.
- Card viewports: Dialog/ConfirmDialog use `cardMode: single` with ≥760px-wide
  viewports — below Tailwind's `sm` (640px) the Dialog switches to its mobile
  bottom-sheet layout and pins off-capture.
- `CountUp` initializes display at the target value (no 0→N animation on first
  mount), so captures are deterministic.

## Known render warns (triaged as legitimate)

- `[TOKENS_MISSING] --radius-lg, --radius-md, --radius-sm, --tw-gradient-stops, --tw-shadow-color`:
  the `--tw-*` ones are Tailwind runtime vars (expected absent). The `--radius-lg/md/sm`
  refs come from app screens using `rounded-[var(--radius-lg)]` (BillingBanner,
  FirstUseTour, LogoUploadField) — those vars are undefined in the app's own CSS
  too (likely meant `--radius`); an app bug worth fixing upstream, not a sync issue.
  No DS component uses them.

- **App observation**: `kova-*` Tailwind colors are defined as plain `var(--kova-*)`
  (not alpha-capable), so opacity-modifier classes used in app source
  (`bg-kova-blue/10`, `border-kova-blue/20`, `bg-kova-growth/15` in view-states,
  badge success variant, etc.) never compile — in the app either. The UI happens
  to look fine with the fallback, but it's silent divergence from design intent.
  Fix upstream by defining kova colors with `<alpha-value>` if wanted; the
  conventions header steers the design agent to semantic tints instead.

## Environment

- Playwright: repo pins 1.59.1 → chromium-1217, already in the local
  ms-playwright cache. `.ds-sync` deps: esbuild, ts-morph, @types/react,
  playwright@1.59.1, typescript@5.9 (**not** typescript@7 — its API breaks the
  validate `.d.ts` parse check, which then silently skips).
- Windows/git-bash: watch the cwd — several converter scripts were accidentally
  run from subdirs because `cd` persists between shell calls.

## Re-sync risks

- `frontend/ds-entry.ts` + `componentSrcMap` are a **manually curated** export
  surface: a new component added under `frontend/src/components/` is NOT picked
  up until both are updated (add the export to the barrel + the pin to the map).
- The tailwind safelist in `.design-sync/tailwind.dssync.config.js` mirrors the
  app's `tailwind.config.js` color/token names as of 2026-07-22 — if the app
  config renames kova tokens, refresh the safelist COLOR_NAMES list.
- `tsconfig.dssync.json` includes `src/components` + `src/lib`; if components
  grow imports into other app dirs, tsc still follows them, but check the emit
  stays clean (`vite/client` types are required for `*.module.css` / import.meta.env).
- Preview content (product names, prices) is invented-but-plausible es-MX POS
  copy — safe, but keep it realistic if edited (brand rule: no demo-looking data).
- The excluded exports (PWAUpdatePrompt, IntroAnimation) are deliberate: app-specific,
  not reusable DS parts. RealTime's CountUp/LivePulse ARE included (judgment call —
  reusable dashboard primitives; flag to user if they disagree).

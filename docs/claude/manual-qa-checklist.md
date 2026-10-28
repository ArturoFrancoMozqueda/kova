# Manual QA Checklist

Use this checklist before finishing meaningful Kova changes.

## Core flows

- Signup.
- Login.
- Logout.
- Billing gate.
- Checkout/success/cancel behavior when relevant.
- Product setup.
- Catalog import: preview one CSV and one single-sheet XLSX; verify formulas/macros/multiple sheets are rejected without writes.
- Employee setup.
- Inventory setup.
- POS sale flow.
- Reports/dashboard flow.

## UI states

- Loading.
- Empty.
- Error.
- Success.
- Mobile.
- Tablet.
- Desktop.

## Accessibility

- Keyboard-only pass: Tab from load reaches the "Saltar al contenido" skip link; Enter lands in the content area.
- Open and close a modal (shared Dialog) and the register's mobile sale-success overlay: focus moves in, Tab is trapped, Escape closes, focus returns to where it was.
- Screen reader spot check (NVDA/VoiceOver): failed login is announced, dialogs announce their title, toasts are announced.
- Contrast: muted/warning text ≥ 4.5:1 on its actual surface; icons and focus rings ≥ 3:1 (use `text-warning-strong`, not `text-warning`, on light backgrounds).
- 200% browser zoom: register and reports stay operable with no clipped controls.
- `prefers-reduced-motion: reduce`: animations and transitions are neutralized.
- `npm run lint` passes (includes jsx-a11y) and the axe smoke tests in AuthView/CatalogView tests pass.

## Safety

- No fake production analytics.
- No exposed secrets.
- No localStorage/sessionStorage token storage.
- No cross-tenant data leakage.
- No broken unpaid/paid access state.

## Offline ("funciona sin internet")

Run against production (`https://kovasuite.com`) or a local instance before onboarding a beta
tenant, and whenever sync, the service worker or the register changes. Use a tenant with an active
subscription and at least three products. IndexedDB database: `pos_offline`, table
`offline_sales` (`frontend/src/offline/db.ts`).

- Sale while offline: with DevTools Network set to Offline, `/register` loads from the service
  worker cache, a cash sale completes, the sidebar shows "Sin conexión" with a pending count, and
  the row is `pending` in `offline_sales`.
- Reconnect: back online, the pending count returns to 0 within seconds, the row moves
  `pending → syncing → synced`, and the sale appears in Ventas with the correct total and items.
- Manual sync from the Sincronización view sends the queued sale once online.
- Dead letter: a sale the server rejects with 4xx goes straight to `failed` (no backoff); retrying
  it from Sincronización returns it to `pending`.
- Idempotency: one offline sale produces a single `POST /api/v1/orders`; pressing Cobrar twice on
  the same cart creates one order (`Idempotency-Key` is the row's `client_uuid`).
- Legacy rows without `tenant_id` stay `quarantined`, never sync, and are handled with the
  [quarantine runbook](../runbooks/offline-legacy-quarantine.md).
- Service worker: public and auth routes in `navigateFallbackDenylist` (`frontend/vite.config.ts`)
  always hit the network; authenticated POS routes render from cache offline. The SW registers with
  `registerType: "prompt"`, so a new deploy waits for the app's update flow.
- Promise check: "funciona sin internet" in `i18n/messages.ts` still describes behavior a user can
  reproduce in 60 seconds with DevTools Offline.

On failure, record browser and version, Network and IndexedDB screenshots and the row status,
without tenant identifiers or sale payloads in git.

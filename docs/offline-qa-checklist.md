# Offline QA Checklist

Living checklist for verifying the "funciona sin internet" promise. Run end
to end against `https://point-of-sale-ochre.vercel.app/` (or a local
`npm run dev` instance) before each beta tenant onboarding.

Reference architecture: `CLAUDE.md` § "Offline sync (Dexie)".

## Pre-test setup

- [ ] Login as a tenant with at least 3 active products (cafe preset works).
- [ ] Confirm `/api/v1/billing/subscription` returns `allowed: true`.
- [ ] Open DevTools → Application → IndexedDB → `pos_offline`.
- [ ] Clear the `offline_sales` table so the test starts from zero.

## Golden path: sale while offline

- [ ] In DevTools → Network, set throttling to **Offline**.
- [ ] Navigate to `/register`. Page must load from the service worker cache.
- [ ] Add at least one product to the cart and complete a cash sale.
- [ ] Expected: success toast/card renders; sale is queued (no 5xx error).
- [ ] AppShell sidebar shows the "Sin conexión" badge and pending count > 0.
- [ ] In `pos_offline.offline_sales`, the row exists with `status: "pending"`.

## Reconnect and sync

- [ ] Switch DevTools throttling back to **Online**.
- [ ] Within 5 seconds the badge should clear and pending count → 0.
- [ ] Row in `offline_sales` transitions `pending → syncing → synced`.
- [ ] Order appears in `/orders` with the correct total and items.

## Manual sync

- [ ] Repeat the offline-sale step but **do not reconnect**.
- [ ] Open the in-app `Sincronización` view (or call `useSyncQueue().syncNow()`).
- [ ] Confirm the manual trigger sends the queued sale once the browser is
      back online.

## Dead-letter retry

- [ ] Manually edit a queued row's `sale.items` to reference a deleted
      product (or use a tenant that has been wiped) so the next sync gets
      a 4xx.
- [ ] Trigger sync. Expected: row goes to `status: "failed"` immediately
      (no retry backoff for client errors).
- [ ] In the in-app dead-letter UI, call `retryDeadLetter(client_uuid)`.
- [ ] Row returns to `pending` and reattempts on the next sync trigger.

## Idempotency

- [ ] Disable network. Submit one sale. Re-enable and observe a single
      `POST /api/v1/orders` (Network panel).
- [ ] Disable network again, hit Cobrar twice in quick succession on the
      same cart, re-enable. Confirm only one order is created (the
      `Idempotency-Key` header is the row's `client_uuid`).

## Service worker behavior

- [ ] DevTools → Application → Service Workers: the active SW is "auto
      update". A new deploy should activate silently on the next
      navigation (no "Nueva versión" prompt).
- [ ] `/`, `/login`, `/signup`, `/verify-email`, `/billing/*`, and `/api/*`
      must hit the network even when offline (denylist).
- [ ] Authenticated POS routes (`/dashboard`, `/register`, `/inventory`)
      must render from cache when offline.

## Promise check

- [ ] The string "funciona sin internet" (and equivalents in `i18n/messages.ts`)
      still maps to behavior the user can reproduce in 60 seconds with
      DevTools Offline.

## When this fails

Capture: tenant id, browser + version, screenshots of Network + IndexedDB
state, and the `offline_sales` row contents. File against the Sprint 5
risk register before onboarding more cafe tenants.

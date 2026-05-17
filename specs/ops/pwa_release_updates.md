# PWA Release Update Spec

## Problem

Returning production browsers can keep using a stale service-worker-controlled app shell after a new
deployment. In a POS, this can show outdated pricing, landing copy, register behavior, or billing
states even though the production URL is correct.

## Target Users

- Tenant owner
- Cashier
- Internal support operator

## Business Value

Reliable release updates prevent support confusion and make production reviews reproducible. A paid
tenant must not see old pricing or old checkout behavior because their browser retained an obsolete
app shell.

## Functional Requirements

- The app registers the service worker immediately in production.
- When an updated service worker is available, the app shows a visible update prompt.
- The prompt must let the user refresh into the newest app shell.
- Applying the update must call the PWA update callback with reload enabled.
- The app shell must not cache API responses; API routes remain network-only.
- Breaking UI releases may force a refresh by using the update prompt copy, but should not interrupt
an in-progress sale without user action.
- The update prompt must be available on public and authenticated routes.

## Non-Functional Requirements

- The update prompt must be accessible with `role="status"` and `aria-live="polite"`.
- The prompt must not cover the register cart or checkout controls on tablet/mobile in a way that
prevents sale completion.
- Service worker release behavior must be covered by E2E or integration tests where practical.

## Offline Impact

- Offline sales queue data in IndexedDB must not be cleared by app shell updates.
- API calls remain `NetworkOnly` so stale API responses are never served as current tenant data.
- App shell precache may serve the currently installed version while offline.

## Error States

- If update application fails, the prompt remains visible and the user can retry.
- If the browser does not support service workers, the app runs without PWA update behavior.

## Test Matrix

| Scenario | Layer | Expected Result |
|---|---|---|
| New service worker available | Frontend unit/E2E | Update prompt appears |
| User applies update | Frontend unit/E2E | App dispatches update event and reloads through update callback |
| API request while service worker active | E2E | Request is network-only, not cached |
| Returning browser after deploy | Production smoke | Latest landing/app shell is visible after accepting update |

## Acceptance Criteria

- Returning browsers can reach the newest production app shell without manual cache clearing.
- Users receive a visible update prompt when a new service worker is waiting.
- No API response is cached by Workbox.
- Production smoke testing includes a returning-browser update check.

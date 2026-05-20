# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Development Commands

### Frontend (`frontend/`)

```sh
npm run dev          # dev server on :5173 (proxies /api/* to :8000)
npm run build        # tsc --noEmit && vite build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test -- --run    # vitest single-pass (CI)
npm test             # vitest watch mode
npm run test:e2e     # playwright (all projects)

# Run a single Vitest file
npm test -- --run src/__tests__/App.test.tsx

# Run a subset of E2E tests
npm run test:e2e -- e2e/register-sale.spec.ts --project=chromium
```

### Backend (`backend/`)

All commands use `uv run` from the `backend/` directory.

```sh
uv sync                                       # install deps
uv run uvicorn app.main:app --reload          # dev server on :8000
uv run ruff check .                           # lint
uv run pytest                                 # full test suite
uv run pytest app/tests/test_auth.py          # single file
uv run pytest -m "p0 or billing"              # by marker
uv run alembic upgrade head                   # apply migrations
uv run alembic downgrade base                 # revert all
uv run alembic revision -m "description"      # new migration
```

On Windows CI the virtual env must be explicit:
```sh
UV_PROJECT_ENVIRONMENT=.venv-win uv run pytest
```

### Full stack (Docker)

```sh
cp .env.example .env
docker compose up --build           # db + backend + frontend
docker compose down -v              # destroy local Postgres volume
```

---

## Architecture

### Stack

- **Backend:** FastAPI + SQLAlchemy (sync) + PostgreSQL (Supabase). Module layout: `app/{domain}/models.py`, `repository.py`, `service.py`, `router.py`, `schemas.py`. All routers registered in `app/main.py` via `create_app()` factory.
- **Frontend:** Vite + React + TypeScript. No global state manager — each view owns its data via `useState`/`useEffect`. The only app-wide contexts are `AuthContext` (session) and `ToastProvider`.
- **Database:** Alembic migrations in `backend/alembic/versions/`. Latest revision: `0023_standard_plan_299_mxn`.

### Frontend ↔ Backend communication

Vite proxies all `/api/*` requests to `http://localhost:8000` in dev (`vite.config.ts`). There is no `VITE_API_BASE_URL` — every API call uses a relative path like `/api/v1/...`. In production a reverse proxy handles routing.

### Auth flow

Cookies only — no `localStorage`. Two tokens:

- `access_token`: JWT (HS256, 15 min), path `/`. Payload: `sub` (user_id), `tid` (tenant_id), `jti` (session_id).
- `refresh_token`: opaque `secrets.token_urlsafe(32)` stored as SHA-256 in the `sessions` table, 30-day TTL, path `/api/v1/auth` (sent only to refresh/logout endpoints).

`get_current_session` dependency (`app/shared/dependencies.py`) decodes the JWT, validates the `UserSession` row (checks `revoked_at`), loads `User` and `Membership`, then calls `set_config('app.tenant_id', ...)` on the Postgres connection to activate RLS.

Frontend auth state lives in `src/auth/AuthContext.tsx`. On every navigation it probes `GET /api/v1/auth/session` (returns `{authenticated: false}` instead of 401 when logged out). `RequireAuth` redirects to `/login` if unauthenticated.

### Multi-tenancy

Two-layer enforcement — application layer and Postgres RLS:

1. **Application:** `membership.tenant_id` from the validated JWT is passed explicitly to every repository call.
2. **RLS:** `get_current_session` executes `SELECT set_config('app.tenant_id', :tid, true)` on the DB connection. Every domain table has a `tenant_isolation` policy: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.

The `tid` claim in the JWT is used only to look up the `Membership` row — a forged `tid` would find no membership and fail. Backend-only tables (`tenants`, `users`, etc.) have RLS enabled but no tenant policy (ADR-009).

### Offline sync (Dexie)

IndexedDB database `pos_offline` (Dexie 4) has one table: `offline_sales`, keyed on `client_uuid`.

Item lifecycle: `pending → syncing → synced | failed`. Network errors retry (back to `pending`); HTTP 4xx/5xx errors go directly to `failed` (dead letter). Max 5 attempts with backoff `[2, 8, 30, 60, 120]` seconds. `retryDeadLetter(clientUuid)` resets a failed item.

Sync triggers on `window.online` and via `useSyncQueue().syncNow`. `useSyncQueue` subscribes to Dexie `liveQuery` so the pending count updates reactively. The `client_uuid` is sent as `Idempotency-Key`; the backend's `idempotency_keys` table memoizes the response to prevent duplicate orders on retry.

### Billing gate

`require_commercial_access(permission)` (`app/billing/access.py`) is a FastAPI dependency that composes RBAC + billing checks. Access is allowed when:

- Subscription status is `active` or `trialing`
- Status is `past_due` but `grace_period_ends_at` is in the future
- No subscription exists and `tenant.created_at + billing_trial_days` (default 7) is in the future

Blocked requests raise HTTP 402 with `{ reason, recovery_path: "/settings/billing" }`. The frontend `BillingBanner` component reads this from `GET /api/v1/billing/subscription`.

### i18n

All UI strings live in `frontend/src/i18n/messages.ts` as a single typed `copy` object (no i18n framework). Strings are Spanish (es-MX). Interpolated strings are inline functions: `copy.inventoryView.trackedProducts: (n) => \`${n} productos...\``. To add a string: add a key to `copy` and import `{ copy } from "@/i18n/messages"`. The `@/` alias maps to `frontend/src/`.

### File upload pattern (in-DB blob storage)

Binary assets (e.g., receipt logo) are stored as `LargeBinary` in a dedicated table (`tenant_logo_files`) with a `byte_size` column and cache-busted URL `/api/v1/settings/receipt/logo/{tenant_id}?v={epoch}`. The pattern is self-contained: multipart parser in the router, blob row per resource, serve endpoint returns `Response(content=bytes_data, media_type=...)`. See `app/business_settings/logo_router.py` and `frontend/src/settings/LogoUploadField.tsx` as the canonical reference.

### Testing patterns

**Backend:** Session-scoped `apply_migrations` fixture runs `alembic upgrade head` once. Per-test `db` fixture wraps each test in a savepoint and rolls back, overriding the `get_db` dependency. `APP_ENV=local` is force-set in `conftest.py` to disable rate limiting. BDD tests in `app/tests/bdd/` use `pytest_bdd` pointing to `.feature` files in `specs/`.

**Frontend:** Vitest + jsdom. Offline/Dexie modules are mocked in unit tests (`vi.mock("../offline/queue", ...)`). E2E (Playwright) smoke tests against a deployed Vercel URL require `PLAYWRIGHT_BASE_URL` env var and only run in CI.

---

## Purpose of This File (Rebrand Context)

This file also defines the brand identity and UI/UX rules for the Kova rebrand of the existing POS MVP. Claude Code must read this section before making any change to frontend, design, copy, or branded assets.

This is a brand refresh, not a rebuild. The existing MVP stays exactly as it is. We are only updating the visual layer to match the new Kova identity. The product is being rebranded from "Sweet Home POS" to Kova — a customizable multi-tenant POS for small and medium businesses in Mexico.

## What This Rebrand Touches

✅ YES — change these:
- Logo (everywhere it appears)
- Brand name in all UI ("Sweet Home" → "kova")
- Color palette / design tokens
- Typography (move to DM Sans)
- Border radius, spacing, button styles
- Microcopy tone and voice
- Marketing/landing pages
- Auth screens visual layer
- Dashboard visual layer
- App icon, favicon, splash screen
- Email templates (visual only)
- Loading/empty/error states styling
- Animations (add intro animation, real-time pulses)

❌ NO — do not touch these:
- Backend logic (FastAPI routes, services, models)
- Database schema or migrations
- Business logic in the frontend (sales flow, offline sync, cart, payments)
- Component file structure (only update what's inside)
- Routing structure
- API contracts
- Stripe integration
- Permission/auth logic
- i18n keys (only their text values where appropriate)
- Sprint 15 (modifiers) or any in-flight feature work — let those merge first

If unclear whether something is "branding" or "logic," ASK before changing.

## Brand Identity

**Product name:** kova (always lowercase in wordmark, including in UI strings)
**Tagline:** "Tu negocio, en flujo constante."
**Tone:** cercano, premium, cálido, profesional pero accesible
**Audience:** dueños de PyMEs en México
**Inspiration:** Stripe, Linear, Notion, Supabase — adapted for the Mexican market

### Brand symbol

The logo is a closed circuit of 3 outer nodes (negocio, cliente, dinero) connected by 3 arcs, with a central blue core (Kova orchestrating the flow). Implement as a single component with two variants:
- `isotipo` → only the symbol
- `horizontal` → symbol + wordmark

The symbol must never be rotated, distorted, recolored outside the brand palette, or have its node proportions changed.

## Design Tokens

All colors and spacing must come from CSS variables. Never hardcode hex values.

| Token | Hex | Use |
|---|---|---|
| `--kova-blue` | `#4F7EF7` | Primary action, links, focus, CTA accent |
| `--kova-blue-light` | `#7BA7FF` | Hover states, secondary accents |
| `--kova-ink` | `#0F1117` | Primary text, logos, primary CTA bg |
| `--kova-mist` | `#F5F6FA` | Page backgrounds, surfaces |
| `--kova-growth` | `#1EBF8A` | Positive metrics ONLY (sales up, goal hit) |
| `--kova-muted` | `#6B7A99` | Secondary text |
| `--kova-tertiary` | `#8892A4` | Tertiary text, captions |
| `--kova-border` | `#E2E6EF` | Default borders (always 0.5px) |

`--kova-growth` is reserved exclusively for positive movement. Do not use it for buttons, links, or decoration.

### Typography

- **Family:** DM Sans (Google Fonts), weights 400 / 500 / 600 / 700 only
- **Hero:** 48px / 600 / letter-spacing -1.5px
- **H2:** 36px / 600 / letter-spacing -0.8px
- **H3:** 18–20px / 600 / letter-spacing -0.3px
- **Body:** 14–16px / 400 / line-height 1.5–1.6
- **Label:** 11–12px / 500 / uppercase / letter-spacing 0.14em
- **Numbers (money, counts):** `font-variant-numeric: tabular-nums`

### Spacing

Use multiples of 8: 8, 16, 24, 32, 48, 64, 80. Migrate existing arbitrary spacing toward these values when touching a file, but don't refactor for refactor's sake.

### Border radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6px | chips, small tags |
| `--radius-md` | 8px | buttons, inputs |
| `--radius-lg` | 10px | cards, KPIs |
| `--radius-xl` | 14px | sections, modals |

### Borders and shadows

- Default borders: `0.5px solid var(--kova-border)`
- Shadows: minimal. Exception: hero/preview cards `0 24px 60px -20px rgba(15,17,23,0.25)`

## UI / UX Principles

**Microcopy:**
- Headings: sentence case, never Title Case
- Buttons: imperative verb + noun ("Crear venta", "Guardar producto")
- Errors: cause + recovery action
- Empty states: explain + primary action
- All text through i18n keys (default es-MX)

**Icon system:** Use whatever icon library the repo already uses — do not introduce a new one. Color inherits from text color, never hardcoded.

**Money formatting:** Use the existing formatter in `frontend/src/orders/format`. Do not change its location or signature.

## Animation Standards

Never block interaction. Animations communicate state changes and reinforce "en flujo constante."

**Timing:**
- Micro-interactions: 120–180ms
- State transitions (modals, drawers): 220–280ms
- Page transitions: 280–360ms
- Intro animations: max 4s, skippable after 1s

**Easing:**
- Entrances: `cubic-bezier(0.16, 1, 0.3, 1)`
- Exits: `cubic-bezier(0.4, 0, 1, 1)`
- Spring pop: `cubic-bezier(0.34, 1.56, 0.64, 1)`

**Intro animation sequence:**
1. 0–1.3s: Three outer nodes pop in sequentially (spring easing), labels appear
2. 1.3–2.6s: Three arcs draw clockwise, 700ms each, staggered 300ms
3. 2.6–3.2s: Central blue core scales in with ring + dot
4. 3.2–4.0s: Labels fade, wordmark "kova." and tagline fade in
5. 4s+: Blue particles flow along arcs. Core pulses every 2.2s

Must respect `prefers-reduced-motion` — render final state instantly when set.

**Real-time UI (dashboard):**
- Sales counter: count-up on update (600ms ease-out)
- Live badge dot: pulse every 1.5s
- New sale row: slide in from top (240ms), then highlight bg fade (800ms)
- KPI delta arrows: rotate 180° if trend flips
- Chart lines: smooth transition to new values, no full redraw

## Migration Strategy

Incremental, not a rewrite. Status as of 2026-05-17:

**Phase 1 — Foundation — DONE**
- Tokens in `frontend/src/styles.css`
- DM Sans loaded (`tailwind.config.js`, `index.html`)
- Logo component at `frontend/src/components/brand/Logo.tsx` (isotipo + horizontal)
- `formatMoney` centralized in `frontend/src/orders/format`

**Phase 2 — Component primitives — DONE** for shared primitives (Button, Card, BillingBanner, Badge). Remaining legacy `hsl(var(--primary))` is intentional during gradual transition; replace only when touching the file for another reason.

**Phase 3 — Brand swap — DONE**
- Logo used in AuthView, VerifyEmailView, AppShell sidebar
- No "Sweet Home" strings remain in `src/`
- Favicon + PWA icons updated (`frontend/public/`)
- PWA manifest (`vite.config.ts`) has Kova name/description and `lang es-MX`
- Email templates updated to Spanish + Kova brand (`backend/app/email/service.py`)
- Page title set to "kova · POS para tu negocio"

**Phase 4 — Landing and auth polish — IN PROGRESS**
- Landing copy refreshed in i18n
- Auth subtitles + placeholders added (commit 351a544)
- IntroAnimation component exists; ensure it's wired into landing hero
- Pending: full es-MX localization of `messages.ts`

**Phase 5 — Dashboard polish — IN PROGRESS**
- Sidebar Kova logo: DONE (AppShell renders LogoMark)
- Real-time animations: count-up KPIs and live pulse badge — NEW work, gated behind incremental commits
- KPI cards using tokens, charts color audit pending

**Phase 6 — Long tail**
- Audit remaining hardcoded colors in `routes/` (`Home.tsx` contains scoped CSS variables for its own landing dark theme — those are not violations)
- Final visual QA pass per screen

**Stripe live keys / live Checkout — LAST step before GA.** Do not switch until everything else is approved. Stays in test mode in production. This is a hard rule per product owner.

Do not start a new phase until the previous one is reviewed and approved.

## Working Mode for Claude Code

When making any change:
1. Read `CLAUDE.md`.
2. Read `docs/current-sprint.md` to confirm no conflict with in-flight work.
3. Identify which Phase (1–6) this change belongs to.
4. If the change touches business logic or backend, STOP and ask.
5. Make the smallest possible change that achieves the brand goal.
6. Verify the affected screens still function (not just look).
7. Report files touched and which screens need manual verification.

## Planning Docs Convention (Non-Negotiable)

`docs/current-sprint.md` is the single source of truth for what is in flight and what is next.

| Doc | Role |
|---|---|
| `docs/current-sprint.md` | Active backlog, pre-beta checklist. Always update when work changes status. |
| `docs/sprint-planning.md` | Historical roadmap and completed sprints only. |
| `docs/ux-review-2026-05-19.md` | Detailed UX review notes. Don't duplicate into `current-sprint.md`. |
| `docs/deferred-scope.md` | Explicit out-of-scope list. Feature moves in-scope only per the rule at the bottom. |
| `docs/risk-register.md` | Risks and release gates. |

**Hard rules:**
1. Do not create new top-level planning docs. Push back and update `current-sprint.md` instead.
2. Before starting a session, read `current-sprint.md` and cross-check at least one item against actual code. Surface any `[ ]`/`[x]` discrepancies before making changes.
3. When you finish a task, update `current-sprint.md` in the same change set.
4. If planning docs conflict, reconcile before adding new work.
5. Archived docs do not come back. Point to the equivalent section in `current-sprint.md`.

## Non-Negotiable Rules

- Do not refactor for refactor's sake. Touch only what serves the rebrand.
- Do not introduce new dependencies without explicit approval.
- Do not change component APIs. Update internals, keep signatures.
- Do not break existing tests. If a test fails due to brand changes, update minimally.
- Do not change routing, paths, or URLs.
- Do not touch the backend (rebrand work only — feature work follows normal process).
- Do not deploy. Just commit and wait for review.

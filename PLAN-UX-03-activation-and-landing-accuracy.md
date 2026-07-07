# PLAN-UX-03 — Activation Instrumentation & Landing Accuracy

## Priority and rationale

**Rank 3 of the UX plans.** Kova's growth depends on turning landing visitors into activated, paying tenants — but today the team is **blind at the top of the funnel**: the landing fires zero analytics and the telemetry sink requires an authenticated session, so visit → CTA → signup conversion is unmeasurable (F-ACT-1). You cannot optimize what you cannot see. Two landing accuracy issues compound the trust story: an **overclaim** ("qué productos te dejan mejor margen" — no cost/margin data exists, F-LAND-1) and a **plan-name mismatch** ("Plan Kova" vs the product's "Plan Standard", F-SUB-2). This plan makes the funnel measurable end-to-end and fixes the two copy defects.

This **supersedes and details** the "landing funnel events" bullet in `PLAN-05` (companion). PLAN-05 should cross-reference here rather than duplicate.

## Goal

- The full funnel is measurable: **landing page-view → CTA click → signup → first product → first sale → checkout → trial-to-paid**, plus `login` and `open_shift` rungs.
- Pre-authentication events (landing) can be recorded (anonymous, `client_id`-keyed) without weakening auth on the rest of the API.
- The landing makes only claims the product delivers: the margin line is corrected (or backed by a real cost field — decision below), and the plan name is consistent.

## Current behavior (repository evidence)

- **Funnel events** defined in `frontend/src/telemetry/funnel.ts`, fired at: `signup_completed` (`AuthView.tsx:71`, queued), `first_product_created` (`CatalogView.tsx:742`), `first_sale_completed` (`RegisterView.tsx:502`), `checkout_started` (`BillingView.tsx:124`), `trial_to_paid` (`BillingView.tsx:144`), `onboarding_tour_*`, `trial_chip_clicked`.
- **Delivery gated to authed:** `flushFunnelEvents()` runs only when `state.status === "authenticated"` (`AppShell.tsx:102-106`); the sink `POST /api/v1/telemetry/events` requires `get_current_session` (`telemetry/router.py:18`). So anonymous/pre-signup events cannot be recorded.
- **Landing fires nothing:** `Home.tsx` CTAs are plain `<Link to="/signup">`; no page-view, no CTA-click event.
- **Overclaim:** `messages.ts:65` "qué productos te dejan mejor margen"; there is **no cost/margin field** (`catalog/types.ts`, `backend/app/catalog` have none); reports rank by sales/units.
- **Plan name:** landing pricing card "Plan Kova" (`messages.ts:216`) vs product/billing "Plan Standard" (`standardPlan.ts`, `BillingView.tsx:276`, onboarding).

## Problems identified

1. F-ACT-1: no landing analytics + auth-only sink → top-of-funnel invisible.
2. F-ACT-2: missing `login`, `open_shift` (and a true anonymous signup-click) rungs.
3. F-LAND-1: margin overclaim not deliverable.
4. F-SUB-2: plan-name inconsistency between landing and product.

## Scope

**Included:** an anonymous/pre-auth telemetry path (endpoint + client), landing page-view/CTA events in `Home.tsx`, `login`/`open_shift` events, and the two copy fixes. **Excluded:** third-party analytics SDKs (the repo deliberately uses first-party telemetry + CSP `connect-src 'self'` — keep it that way for privacy), building a full margin/cost feature (offered as an option, not required), retention emails (companion PLAN-01 trial reminders).

## Exact files to modify / create

- **`backend/app/telemetry/router.py`** — add an **anonymous** ingestion path for a bounded allowlist of pre-auth event types (`landing_viewed`, `landing_cta_clicked`, `signup_started`), keyed by the client-generated `client_id` (already in `funnel.ts`), rate-limited, CSRF-exempt (no cookie), and **strictly validated** (reject any event type not on the anonymous allowlist; no tenant/user fields accepted). Keep the existing authenticated path unchanged for all in-app events.
- **`backend/app/telemetry/schemas.py`** (or inline) — an anonymous event schema (event type enum-restricted, `client_id`, timestamp, minimal metadata; no PII).
- **`backend/app/middleware/rate_limit.py`** — add a per-IP limit to the anonymous telemetry endpoint (abuse guard).
- **`frontend/src/telemetry/funnel.ts`** — add an anonymous-send path (POST without credentials to the new endpoint) usable before auth; keep the authed queue/flush for in-app events.
- **`frontend/src/routes/Home.tsx`** — fire `landing_viewed` on mount and `landing_cta_clicked` on each primary CTA (hero, pricing, final CTA), and `signup_started` when navigating to `/signup`.
- **`frontend/src/auth/AuthView.tsx`** — fire a `login` event on successful login; keep `signup_completed`.
- **`frontend/src/shifts/ShiftView.tsx`** — fire `open_shift` on a successful shift open (fills the funnel gap between first product and first sale).
- **`frontend/src/i18n/messages.ts`** — reword `:65` margin line (e.g. "descubre qué días y horas vendes más y qué productos mueven tu ingreso"); rename the pricing card `:216` "Plan Kova" → "Plan Standard".
- **(Optional, if margin is wanted rather than reworded):** `backend/app/catalog/models.py` + migration to add `cost_amount Numeric(12,2)` nullable; `catalog/schemas.py`; reports margin computation; `CatalogView` cost input. This is a **larger** additive feature — default recommendation is to **reword** for beta and defer margin.

New files: telemetry anonymous schema/tests.

## Dependencies

- The anonymous endpoint must be carefully scoped so it does not become an unauthenticated write vector (allowlist + rate limit + no tenant fields). Coordinate with companion S7 (rate-limit posture).
- Copy fixes are independent and can ship immediately as quick wins.

## Step-by-step implementation order

1. **Copy quick wins** (`messages.ts:65,216`). Behavior: accurate landing. Tests: snapshot/RTL for the pricing card name + margin line; a check that no landing string promises "margen". Ship first (zero risk).
2. **Anonymous telemetry endpoint** (`telemetry/router.py`, schema, rate limit). Behavior: accepts only allowlisted anonymous event types, `client_id`-keyed, no auth, rate-limited. Security: strict allowlist + no tenant/user acceptance + per-IP limit. Backward-compat: authed path unchanged. Tests: anonymous event accepted; a non-allowlisted type rejected; rate limit enforced; no tenant leakage.
3. **Client anonymous-send** (`funnel.ts`). Behavior: pre-auth events POST without credentials; in-app events keep the authed queue. Tests: unit — anonymous event uses the anonymous path.
4. **Landing events** (`Home.tsx`). Behavior: page-view + CTA clicks + signup-start. Tests: RTL — mount fires `landing_viewed`; CTA click fires `landing_cta_clicked`.
5. **`login` + `open_shift` events** (`AuthView.tsx`, `ShiftView.tsx`). Tests: RTL — events fire on success.

## Edge cases

- **Bots/scrapers on the landing:** anonymous events will include bot traffic; document that landing counts are gross (dedupe by `client_id`, filter known bots downstream). Don't let bot volume DoS the endpoint — rate limit + bounded body.
- **Ad/tracker blockers:** a first-party same-origin POST is more resilient than a third-party pixel, but some events will still be lost — treat funnel counts as lower bounds.
- **`client_id` continuity:** the same `client_id` (localStorage) should link a pre-auth `landing_viewed` to the later authed `signup_completed` — verify the id persists across the signup navigation and isn't regenerated.
- **CSP:** the landing POST is same-origin (`connect-src 'self'` already allows it) — no CSP change; keep it that way (no third-party).
- **Privacy/LFPDPPP:** anonymous events must carry **no PII** (no email, no name) — only `client_id` + event type + coarse metadata. Reflect in the privacy policy if needed.
- **Duplicate landing_viewed** on SPA re-renders: fire once per page load (guard like `trackFunnelEventOnce`).
- **Margin option:** if a cost field is added later, `cost_amount` must be nullable and reports must handle products without cost (don't show margin for uncosted products) — otherwise a new overclaim.

## Security requirements

- The anonymous endpoint accepts **only** a fixed allowlist of pre-auth event types and **no** tenant/user identifiers; it can never mutate business data.
- Per-IP rate limiting + bounded payload; it must not become a spam/DoS or storage-exhaustion vector.
- No PII in anonymous events; authed telemetry remains authenticated and tenant-scoped.
- No weakening of the existing authenticated telemetry path or CSRF posture (the anonymous path is cookieless, so CSRF-exempt is correct).

## Data migration and rollback

- **No migration** for the analytics/copy work (telemetry_events table already exists; anonymous rows carry `client_id`, null tenant — verify the column nullability or use a dedicated anonymous table if tenant is NOT NULL).
- **If the margin option is chosen:** additive nullable `cost_amount` migration (expand-only, reversible).
- **Rollback:** revert frontend + endpoint; copy fixes revert trivially. Anonymous rows are harmless if the feature is disabled.

## Testing strategy

- **Unit (backend):** anonymous schema validation (allowlist, no tenant fields); rate limit; authed path unaffected.
- **Unit/RTL (frontend):** landing events fire; login/open_shift fire; anonymous vs authed send path selection; pricing name + margin copy.
- **Integration:** end-to-end funnel emits the expected event sequence for a full signup→first-sale run (extend the data walkthrough).
- **Regression:** existing telemetry tests + `AuthView`/`BillingView` funnel tests green.
- **Manual:** load the landing, click a CTA, confirm an anonymous event lands (DB row with `client_id`, null tenant); complete signup and confirm the same `client_id` links to `signup_completed`.

Exact test files: `backend/app/tests/test_telemetry_anonymous.py` (new), `frontend/src/telemetry/funnel.test.ts` (extend), `frontend/src/routes/Home.test.tsx` (new/extend).

## Observability

- A funnel dashboard: `landing_viewed → landing_cta_clicked → signup_started → signup_completed → first_product_created → open_shift → first_sale_completed → checkout_started → trial_to_paid`, with per-step conversion.
- Alert if `landing_viewed` volume drops to zero (instrumentation regression) or if anonymous-endpoint rate-limit rejections spike (abuse).
- No PII in dashboards.

## Acceptance criteria

- Given a visitor loads the landing, when the page mounts, then a `landing_viewed` event is recorded anonymously (keyed by `client_id`, no PII, no auth).
- Given a visitor clicks a primary CTA, then a `landing_cta_clicked` event is recorded, and navigating to signup records `signup_started`.
- Given the same visitor later completes signup, then `signup_completed` is linkable to the earlier anonymous events via `client_id`.
- Given a successful login or shift open, then `login` / `open_shift` events are recorded.
- Given the anonymous telemetry endpoint, when it receives a non-allowlisted event type or a tenant/user field, then it rejects the request; when flooded, it is rate-limited.
- Given the landing, then it contains no "margen" claim and the pricing card reads "Plan Standard".

## Verification commands

```bash
docker compose exec -T backend uv run ruff check
docker compose exec -T backend uv run pytest app/tests/test_telemetry_anonymous.py app/tests/test_rate_limit.py -q
npm --prefix frontend run lint && npm --prefix frontend run typecheck
npm --prefix frontend test -- funnel Home
npm --prefix frontend run build
```

## Definition of done

- Full funnel (including anonymous landing events + login/open_shift) is measurable end-to-end.
- Anonymous endpoint is allowlisted, rate-limited, PII-free, and does not weaken the authed API.
- Margin overclaim reworded; plan name consistent.
- Tests green; lint/typecheck/build/pytest pass; a funnel dashboard is documented.

## Risks and mitigations

- **Risk:** the anonymous endpoint becomes an abuse/DoS vector. **Mitigation:** strict allowlist, per-IP rate limit, bounded payload, no tenant writes.
- **Risk:** privacy exposure via anonymous events. **Mitigation:** no PII, `client_id` only; update the privacy policy.
- **Risk:** funnel numbers over-read (bots/blockers). **Mitigation:** document counts as lower bounds; dedupe by `client_id`.
- **Risk:** the margin fix is done as a feature and reintroduces an overclaim for uncosted products. **Mitigation:** default to rewording for beta; if adding cost, gate margin display on presence of cost.

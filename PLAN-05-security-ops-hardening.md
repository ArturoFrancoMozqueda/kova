# PLAN-05 — Security & Operational Hardening

## Priority and rationale

**Rank 5.** A batch of individually low-to-medium findings that together close the remaining defense-in-depth, correctness, and operational gaps, plus the quick wins. None is a standalone blocker, but each removes a real edge-case failure or support burden, and several are near-zero effort. Grouping them keeps PLAN-01–04 focused on their headline risks while ensuring nothing surfaced by the audit is dropped.

Contents: last-owner TOCTOU (S3), sessions not revoked on deactivation/role change (S4), multi-tenant login `.first()` (D8), public unauthenticated asset reads (S2), invite password policy + bcrypt truncation (S5), rate-limit fail-open review (S7), internal-key constant-time (S6), dev-token DEV guard (S8), SECRET_KEY floor (S9), landing analytics gap (§15), branch consolidation + repo hygiene, and the `ApiError` de-dup.

## Goal

- Tenant owner-count and shift/role mutations are race-safe.
- Deactivating or demoting a user immediately invalidates their sessions.
- A multi-tenant user selects the correct tenant at login.
- Public asset endpoints have a defensible access model with sign-off.
- Invited users get the same password strength as signup; bcrypt handles >72 bytes.
- Rate-limit fail-open behavior is intentional and documented; auth-critical bulk writes fail closed.
- Internal key uses constant-time compare; dev tokens never render in prod builds; SECRET_KEY has an entropy floor.
- The landing page emits activation/conversion analytics.
- Unmerged work (internal-ops dashboard, reports redesign, Sentry-noise filter) has an explicit disposition; repo clutter removed.

## Current behavior (repository evidence)

- **S3:** `_count_active_owners` is an unlocked `COUNT(*)` (`employees/service.py:26-35`, used at `:269, :305`) — TOCTOU allows two concurrent demotes to strand a tenant with 0 owners.
- **S4:** `deactivate_employee` (`:308`) only sets `is_active=False`; no `revoke_all_sessions`. Lockout works via per-request membership check, but `refresh_session` can still mint access tokens.
- **D8:** `get_membership_by_user` returns `.first()` (`auth/repository.py:73-78`), used by `login` (`auth/service.py:257`) — a user in >1 tenant lands arbitrarily.
- **S2:** `get_product_image` (`catalog/image_router.py:226-255`) and `get_receipt_logo` (`business_settings/logo_router.py:189-202`) are unauthenticated, no tenant filter, guarded only by unguessable id.
- **S5:** `InvitationAccept.password` has no Field constraints (`employees/schemas.py:49`); `accept_invitation` checks only `len < 8` (`:204-207`). `hash_password` (`auth/service.py:25-26`) has no SHA-256 pre-hash → bytes >72 silently ignored.
- **S7:** `enforce_rate_limit` no-ops in local, `fail_closed` only in production (`rate_limit.py:234-236`); `checkout` and `sync` are `fail_closed=False` (fail open); invitation preview/accept and telemetry have no limit.
- **S6:** `x_internal_key != settings.internal_api_key` plain compare (`billing/router.py:103`).
- **S8:** `ForgotPasswordView.tsx:57` renders `dev_reset_token` with no `import.meta.env.DEV` guard (backend gates to local).
- **S9:** only the default SECRET_KEY is rejected (`main.py:44-47`); no length/entropy floor.
- **§15:** landing (`frontend/src/routes/Home.tsx`) fires no funnel events; app funnel events exist in `telemetry/funnel.ts`.
- **Branch state:** `feature/full-audit-plan` (== reports redesign) is local-only/unpushed; `feat/internal-ops-dashboard` (+6,619 lines) and `codex/filter-facebook-iab-sentry-noise` are unmerged; stray `.tmp_vite*.log` files committed; `ApiError` defined in three places.

## Problems identified

Enumerated above (S2–S9, D8, analytics, hygiene). Each is a discrete, testable change.

## Scope

**Included:** `backend/app/employees/{service,schemas}.py`, `backend/app/auth/{service,repository,router}.py`, `backend/app/shared/dependencies.py`, `backend/app/middleware/rate_limit.py`, `backend/app/billing/router.py`, `catalog/image_router.py` + `business_settings/logo_router.py` (access model), `frontend/src/auth/ForgotPasswordView.tsx`, `frontend/src/lib/apiError.ts` (+ callers), `frontend/src/routes/Home.tsx` + `telemetry/funnel.ts`, `.gitignore`, tests. **Excluded:** tenant deletion/data-export (compliance, larger effort — track separately), tax engine.

## Exact files to modify

- **`backend/app/employees/service.py`** — `_count_active_owners`: use `SELECT … FOR UPDATE` on owner membership rows (matching the `with_for_update()` pattern at `auth/repository.py:176`) or a tenant-scoped advisory lock so concurrent demotes serialize. `deactivate_employee` and `update_employee_role`: call `revoke_all_sessions(user_id)` after a successful deactivate/role-drop.
- **`backend/app/employees/schemas.py`** — `InvitationAccept.password`: reuse the signup password Field constraints (min 8, max 128, letters+digits).
- **`backend/app/auth/service.py`** — `hash_password`: SHA-256 pre-hash before bcrypt to remove the 72-byte truncation; keep verification compatible (only affects new hashes — document, or re-hash on next login). Login: resolve membership deterministically (see repository change).
- **`backend/app/auth/repository.py`** — add tenant-selection support: return all active memberships; login resolves a default deterministically (most-recent or a `last_tenant_id`) and the API supports choosing a tenant when >1 exists.
- **`backend/app/auth/router.py`** — expose tenant list / selection at login when a user has multiple memberships.
- **`backend/app/billing/router.py`** — internal-key check → `hmac.compare_digest`.
- **`backend/app/middleware/rate_limit.py`** — make `sync`/`checkout` fail closed (or document the fail-open decision explicitly); add limits to invitation preview/accept and telemetry.
- **`backend/app/config.py` / `main.py`** — SECRET_KEY minimum length/entropy check at boot for non-local.
- **`backend/app/catalog/image_router.py` + `business_settings/logo_router.py`** — move to signed/tenant-scoped asset URLs, or add a documented risk sign-off if public-by-id is acceptable.
- **`frontend/src/auth/ForgotPasswordView.tsx`** — wrap dev-token render in `import.meta.env.DEV`.
- **`frontend/src/lib/apiError.ts`** — single `ApiError`; update `auth/api.ts`, `billing/api.ts` to import it.
- **`frontend/src/routes/Home.tsx` + `telemetry/funnel.ts`** — fire landing page-view + CTA-click funnel events.
- **`.gitignore`** — ignore `.tmp_vite*.log`; remove the committed ones.

## Dependencies

- Multi-tenant login (D8) is the largest sub-item (touches auth API + UI); the rest are isolated.
- Independent of PLAN-01–04.

## Step-by-step implementation order

1. **Quick wins (isolated, low risk):** internal-key `compare_digest` (S6); dev-token DEV guard (S8); SECRET_KEY floor (S9); `.gitignore` + remove `.tmp_vite*.log`; consolidate `ApiError`. Each with a focused test where meaningful.
2. **Session revocation on deactivate/role change (S4):** call `revoke_all_sessions` in `deactivate_employee`/`update_employee_role`. Security: closes the token-mint window. Backward-compat: additive. Tests: deactivated user's refresh no longer mints tokens.
3. **Last-owner TOCTOU (S3):** lock owner rows / advisory lock. Tests: concurrent demote leaves ≥1 owner.
4. **Invite password policy + bcrypt pre-hash (S5):** reuse signup validators; SHA-256 pre-hash. Tests: weak invite password rejected; >72-byte password fully significant.
5. **Rate-limit review (S7):** fail closed for `sync`/`checkout` (or document); add invite/telemetry limits. Tests: rate-limit tests updated.
6. **Public asset access model (S2):** signed/tenant-scoped URLs or documented sign-off. Tests: image/logo serving still works; unauthorized cross-tenant probe handled per decision.
7. **Landing analytics (§15):** page-view + CTA events. Tests: vitest asserting events fire.
8. **Multi-tenant login (D8):** deterministic default + tenant selection UI/API. Data model: optional `last_tenant_id`. API: login returns membership list when >1. UI: tenant picker. Backward-compat: single-tenant users unaffected. Tests: multi-tenant user lands in the chosen tenant, not `.first()`.
9. **Branch consolidation (ops):** push `feature/full-audit-plan`/reports-redesign to origin; decide disposition of `feat/internal-ops-dashboard` and `codex/filter-facebook-iab-sentry-noise` (merge, keep, or archive) — note the `observability/sentry.ts` collision between the latter two.

## Edge cases

- **Concurrent owner demotes / deactivations:** must never reach 0 active owners.
- **Deactivated user with a live refresh token:** must not be able to mint a new access token after revocation.
- **Multi-tenant user:** login must be deterministic and let the user switch tenants; access-token requests already carry `tid` so mid-session is fine — the gap is at login.
- **bcrypt pre-hash migration:** existing hashes remain valid; only new/rotated hashes use the pre-hash — document to avoid locking out users.
- **Rate-limit fail-closed on sync:** must not block legitimate offline backlog sync when Upstash flaps — choose a bounded fail-closed (short retry) vs fail-open trade-off deliberately.
- **Public asset URL change:** existing receipts/links referencing old image URLs must not break (keep backward-compatible routes or migrate references).
- **Landing analytics + CSP:** first-party POST to `/api/v1/telemetry/events` is already CSP-allowed (`connect-src 'self'`); no third-party pixel (keep it that way for privacy).
- **Dev-token guard:** must not hide the token in local dev (only in prod builds).

## Security requirements

- No path can strand a tenant with zero owners.
- Deactivation/role-drop invalidates sessions immediately.
- Constant-time comparison for all shared-secret checks.
- Dev-only secrets never render in production builds.
- SECRET_KEY has an enforced entropy floor in non-local environments.
- Public asset access is either authenticated/signed or explicitly risk-accepted and documented.
- Invited users meet the same password policy as signups.

## Data migration and rollback

- **Migrations:** at most an optional `users.last_tenant_id` (additive, nullable) for multi-tenant login default. No other schema changes.
- **Backfill:** none required.
- **Rollback:** all changes are code reverts; the optional column is drop-reversible; branch/hygiene actions are git operations.
- **Recovery if deploy fails:** each sub-item is independent; revert individually.

## Testing strategy

- **Unit:** compare_digest; SECRET_KEY floor; invite password validators; bcrypt pre-hash significance; landing event firing (vitest).
- **Integration/API:** session revoked on deactivate/role change; concurrent owner-demote guard; multi-tenant login selection; rate-limit fail-closed/limits; public asset access per decision.
- **Concurrency:** two-thread owner-demote and (if applicable) deactivate.
- **Regression:** `test_employee_rbac.py`, `test_auth*`, `test_rate_limit.py`, `test_csrf.py` green.
- **Manual:** deactivate a user mid-session → next request and refresh both fail; multi-tenant user sees a tenant picker.

Exact files: `backend/app/tests/test_employee_rbac.py` (owner race, session revoke), `test_auth_multitenant.py` (new), `test_rate_limit.py`, `frontend/src/auth/ForgotPasswordView.test.tsx`, `frontend/src/routes/Home.test.tsx` (analytics).

## Observability

- Audit-log deactivation/role-change with session-revocation outcome.
- Metric on rate-limit fail-closed events (Upstash outage visibility).
- Landing funnel events flow to the existing telemetry pipeline; add a conversion dashboard (page-view → signup → first-sale → trial-to-paid).
- No PII/secrets in logs.

## Acceptance criteria

- Given a tenant with exactly one owner, when two concurrent requests attempt to demote/deactivate the last owner, then at least one is rejected and the tenant always retains ≥1 active owner.
- Given an active user session, when the user is deactivated or demoted, then their existing access token is rejected on the next request and their refresh token can no longer mint a new access token.
- Given a user who is a member of two tenants, when they log in, then they land in a deterministic/selected tenant (not an arbitrary `.first()`), and can switch tenants.
- Given a production build, when the forgot-password flow runs, then no dev reset token is ever rendered.
- Given a non-local environment configured with a short/weak SECRET_KEY, when the backend boots, then boot fails.
- Given the internal ops endpoint, when the key is checked, then a constant-time comparison is used.
- Given a visitor on the landing page, when they view it and click the primary CTA, then page-view and CTA-click funnel events are recorded.

## Verification commands

```bash
docker compose exec -T backend uv run ruff check
docker compose exec -T backend uv run pytest app/tests/test_employee_rbac.py app/tests/test_auth_multitenant.py app/tests/test_rate_limit.py app/tests/test_csrf.py -q
docker compose exec -T backend uv run pytest -q
npm --prefix frontend run lint && npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run check:bundle-secrets
```

## Definition of done

- All acceptance criteria pass with automated tests.
- Owner-count race, session revocation, and multi-tenant login are fixed and tested.
- Quick wins (compare_digest, dev-token guard, SECRET_KEY floor, ApiError de-dup, `.tmp` cleanup) landed.
- Public asset access model decided, implemented, and documented.
- Landing analytics live; conversion funnel measurable.
- Branch dispositions recorded; reports-redesign pushed to origin.
- Full backend + frontend suites green; bundle-secret gate passes.

## Risks and mitigations

- **Risk:** bcrypt pre-hash locks out existing users. **Mitigation:** apply only to new/rotated hashes; verify old hashes still validate; document.
- **Risk:** fail-closed on sync blocks offline backlog during an Upstash flap. **Mitigation:** bounded fail-closed with short retry, or keep fail-open with an alert — decide explicitly.
- **Risk:** multi-tenant login UI adds friction for single-tenant users. **Mitigation:** only show a picker when >1 membership; default deterministically otherwise.
- **Risk:** changing public asset URLs breaks existing receipts. **Mitigation:** keep backward-compatible routes or migrate references; sign-off if staying public.
- **Risk:** scope sprawl across many small items. **Mitigation:** land in the ordered sub-steps; each is independently revertible.

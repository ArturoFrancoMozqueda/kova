# PLAN-02 — Tenant-Isolation Defense-in-Depth (Force RLS + Least-Privilege Role)

## Priority and rationale

**Rank 2.** Kova is multi-tenant SaaS; cross-tenant isolation is existential for trust. Today, isolation is enforced **only** at the application layer (`.filter(tenant_id == ...)`), which is consistent and test-proven — so this is **not an active exploit**, but the documented second layer of defense (RLS) is **inert**: no table uses `FORCE ROW LEVEL SECURITY` and the backend connects as the table owner/superuser, so every `tenant_isolation` policy is silently bypassed. `docs/deployment.md:177` lists "RLS policies authored and tested on Supabase" as an open pre-beta **hard gate**, and ADR-009 lists a separate backend role as intended future work. This plan makes the RLS layer real so a single forgotten app-level filter can never become a cross-tenant leak.

High leverage because it converts a large body of already-written (but dead) policy DDL into an actual guarantee, and it unlocks the one release gate that no product feature can substitute for.

## Goal

- The backend connects to Postgres as a **non-owner, least-privilege role** (`kova_app`) that is subject to RLS.
- Every tenant-scoped table has `FORCE ROW LEVEL SECURITY` so even an accidental owner connection cannot bypass policies.
- `app.tenant_id` is reliably set for every request-scoped transaction, and the intentional no-tenant-context paths (webhook, internal endpoint, public assets, auth) have an explicit, documented strategy.
- A real RLS test connects as `kova_app`, sets `app.tenant_id` to tenant A, and proves tenant B's rows are invisible at the SQL layer — the test that is currently impossible to pass.

## Current behavior (repository evidence)

- **No `FORCE ROW LEVEL SECURITY`** anywhere (repo-wide search: zero matches). Every policy is `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation ... USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`.
- **One connection role does everything.** `backend/alembic/env.py:9` and `backend/app/db.py:13` both use `settings.database_url`; `backend/fly.toml:12` runs `alembic upgrade head` as the release command with the app's `DATABASE_URL`; `docs/deployment.md:59` documents the URL as the Supabase `postgres` (owner/superuser) role. Owner + superuser bypass non-forced RLS.
- **No separate role exists.** Repo-wide search for `CREATE ROLE`/`CREATE USER`/`GRANT`/`SET ROLE` returns nothing (only a `REVOKE EXECUTE ON FUNCTION` in 0013). ADR-009:48 marks a backend-only role as future work.
- **`app.tenant_id` is set only in `get_current_session`** (`backend/app/shared/dependencies.py:45-48`) via `SELECT set_config('app.tenant_id', :tid, true)` (transaction-local). Paths that never call it: Stripe webhook (`billing/router.py:78`), internal subscriptions (`billing/router.py:92`), public product image (`catalog/image_router.py:226`), receipt logo (`business_settings/logo_router.py:189`), and auth/login lookups. They work today precisely because RLS is inert.
- **Migration 0027 drops the policy on `membership_invitations`** (unauthenticated accept flow); `users` and a few reference tables intentionally have no tenant policy (ADR-009). Only `telemetry_events` has a `WITH CHECK` clause; all others are `USING`-only (no write constraint).
- **Tests prove app-level isolation only.** `test_tenant_isolation*.py` runs over the owner connection; no test would fail if every policy were dropped.

## Problems identified

1. RLS policies are dead code at runtime (no FORCE + owner connection).
2. No least-privilege role; the app runs with owner/superuser rights (blast radius + RLS bypass).
3. `USING`-only policies would not constrain writes even under a non-owner role (no `WITH CHECK`).
4. Several code paths rely on RLS being off (they never set `app.tenant_id`); enabling RLS naively would break them.
5. No test asserts RLS actually blocks cross-tenant reads.

## Scope

**Included:** a Supabase role-provisioning procedure + `GRANT`s, an expand-and-contract migration adding `FORCE ROW LEVEL SECURITY` and `WITH CHECK` to write-capable policies, app connection-role split, a strategy for the no-context paths, and a real RLS test harness. **Excluded:** changing the app-level filters (they stay as the primary control), the public-asset redesign (PLAN-05 S2), any product behavior.

## Exact files to modify / create

- **`docs/deployment.md` + a new `backend/scripts/provision_app_role.sql`** — create `kova_app` (NOLOGIN attributes as appropriate, non-owner), `GRANT CONNECT`/`USAGE`/`SELECT,INSERT,UPDATE,DELETE` on domain tables (and sequences) to `kova_app`; `ALTER DEFAULT PRIVILEGES` so future tables are covered. Roles/passwords must **not** live in migration history or `DATABASE_URL` git history — document as a Supabase provisioning step with the password injected via env/secret.
- **`backend/app/config.py` / `backend/app/db.py`** — support a separate app connection string (e.g. `DATABASE_URL` = `kova_app` for the app engine) while **migrations continue to run as owner** via `alembic/env.py` (a distinct `MIGRATION_DATABASE_URL` or the existing owner URL). Keep `pool_pre_ping`.
- **`backend/alembic/env.py`** — read the owner URL for migrations explicitly; document that DDL runs as owner, runtime as `kova_app`.
- **New migration `backend/alembic/versions/0036_force_rls.py`** — loop over every tenant-scoped table (reuse the table-list pattern from `0007`/`0012`/`0018`) and `ALTER TABLE <t> FORCE ROW LEVEL SECURITY`; add `WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)` to write-capable policies that lack it. Symmetric `downgrade()` doing `NO FORCE` and dropping the added `WITH CHECK`.
- **`backend/app/shared/dependencies.py`** — confirm `set_config('app.tenant_id', ..., true)` is set for every request transaction and that no intervening commit resets it before queries run.
- **No-context paths** — one of: (a) a dedicated owner/`BYPASSRLS` connection used only by the webhook/internal/public-asset handlers, or (b) set an explicit tenant context where the tenant is known. Document the chosen approach per handler (`billing/router.py`, `catalog/image_router.py`, `business_settings/logo_router.py`).
- **New test `backend/app/tests/test_rls_enforcement.py`** — connect as `kova_app`, set `app.tenant_id=A`, assert a raw `SELECT` on `orders`/`products` cannot see tenant B; assert an `INSERT`/`UPDATE` with a mismatched `tenant_id` is rejected by `WITH CHECK`.
- **CI (`.github/workflows/ci.yml`)** — provision `kova_app` in the Postgres service before the RLS test; keep the existing owner-run migration step.

## Dependencies

- Supabase admin access to create the role + grants (runtime/dashboard step — flagged as not-verifiable-from-repo; the migration + app split are code, the role creation is ops).
- Must land the connection-role split and the FORCE migration together (a FORCE migration with the app still connecting as owner is a no-op; a role switch without FORCE still bypasses for owner-owned objects — but a non-owner role is subject to non-forced RLS, so the role switch alone already activates policies; FORCE is the belt-and-suspenders).

## Step-by-step implementation order

1. **Provision `kova_app` (ops + `provision_app_role.sql`).**
   - Behavior: least-privilege CRUD role, non-owner, subject to RLS. Data model: no table changes; grants only. Security: dramatically reduces blast radius. Backward-compat: owner still runs migrations. Migration: role creation is an ops step, not an Alembic migration (secrets must not enter history).
   - Tests: CI provisions the role; a connectivity smoke as `kova_app`.

2. **App/migration connection split (`config.py`, `db.py`, `alembic/env.py`).**
   - Behavior: app engine → `kova_app`; migrations → owner. Enabling this alone activates all existing (non-forced) policies for the app connection.
   - Security implication: this is the moment RLS becomes live for app queries — the no-context paths (step 4) must be handled first or in the same change or they will break.
   - Tests: existing suite must stay green **after** step 4.

3. **Add `WITH CHECK` + `FORCE RLS` migration (`0036_force_rls.py`).**
   - Behavior: FORCE on all tenant tables; `WITH CHECK` on write-capable policies. Data model: policy/DDL only. Backward-compat: no data change; up/down/up reversibility must pass CI. Migration: expand-only, fully reversible.
   - Tests: migration reversibility job; RLS test (step 5).

4. **Handle no-tenant-context paths (`billing`, `catalog/image_router`, `business_settings/logo_router`, auth).**
   - Behavior: give each a defined strategy — dedicated owner/BYPASSRLS connection for webhook/internal/public-asset reads, or explicit `set_config` where tenant is known. Auth login cross-tenant lookups run pre-session (before a tenant exists) — must use the owner/bypass path or be explicitly scoped.
   - Security: these become the *only* sanctioned bypass points, documented and minimal.
   - Tests: webhook processing, internal subscriptions listing, public image/logo serving all still work with RLS live.

5. **Real RLS test (`test_rls_enforcement.py`) + CI wiring.**
   - Behavior: connect as `kova_app`, prove cross-tenant reads blocked and mismatched writes rejected.
   - Tests: this is the deliverable proof; it must fail if the FORCE migration or role split is reverted.

## Edge cases

- **Migrations run as owner, app as `kova_app`:** `FORCE` does not impede the owner running DDL. Confirm the app role has privileges on all tables/sequences created by every migration (use `ALTER DEFAULT PRIVILEGES`).
- **`current_setting('app.tenant_id', true)` when unset** returns NULL; `NULL::uuid` comparisons make policies deny-by-default for the app role on request paths that forgot to set it — this is desirable, but verify no legitimate app query runs before `set_config`.
- **Transaction lifecycle:** `set_config(..., true)` is transaction-local; if the request uses multiple transactions or a commit resets state, the tenant context must be re-established. Verify `get_db`/session scope.
- **`membership_invitations`** has its policy dropped (unauthenticated accept) — must remain app-filtered; do not re-add a policy that breaks accept.
- **`users` and reference tables** intentionally have no tenant policy — do not FORCE tables that shouldn't be tenant-scoped.
- **Connection pooling (Supabase pgBouncer):** `set_config(..., true)` (transaction-local) is compatible with transaction pooling; a session-local `set_config(..., false)` would not be — keep transaction-local.
- **Background/scheduled jobs (PLAN-01 reminders):** run as owner or set explicit context; they operate cross-tenant by design.

## Security requirements

- App connection is non-owner and subject to RLS; owner credentials are used only for migrations and the minimal, documented bypass paths.
- `FORCE ROW LEVEL SECURITY` on all tenant-scoped tables; write-capable policies have `WITH CHECK`.
- App-level `tenant_id` filters remain unchanged as the primary control (defense in depth, not replacement).
- No role passwords in migrations, code, or git history.
- The set of RLS-bypass code paths is explicit, minimal, and documented.

## Data migration and rollback

- **Sequence:** provision role (ops) → app/migration split (code) + no-context handling (code) → `0036_force_rls` migration → RLS test.
- **Backfill:** none (policies already exist; this activates/forces them).
- **Compatibility window:** deploy the role split and FORCE migration together; the app must be pointed at `kova_app` in the same release. A brief window where the app still connects as owner is safe (RLS simply stays inert as today).
- **Rollback:** `alembic downgrade` removes FORCE/WITH CHECK; repoint the app `DATABASE_URL` back to the owner role. Both are reversible without data loss.
- **Recovery if deploy fails:** if app queries start failing due to missing grants, repoint to owner (immediate mitigation) and fix grants; no data is mutated by this plan.

## Testing strategy

- **RLS/tenant-isolation tests (new `test_rls_enforcement.py`):** cross-tenant read blocked and mismatched write rejected as `kova_app`.
- **Regression:** the entire existing suite (322 tests) must pass with the app connecting as `kova_app` and RLS forced — this is the real proof that grants + no-context handling are correct.
- **Migration tests:** CI up→down→up reversibility for `0036`.
- **Integration:** webhook, internal subscriptions, public image/logo, auth login all pass with RLS live.
- **Manual:** on a staging Supabase, connect as `kova_app` in `psql`, set `app.tenant_id`, and confirm cross-tenant `SELECT` returns nothing.

Exact files: `backend/app/tests/test_rls_enforcement.py` (new), `backend/app/tests/conftest.py` (add a `kova_app`-role engine fixture), `.github/workflows/ci.yml` (provision role).

## Observability

- Log (once, at startup) which role the app connected as and whether RLS is forced (query `pg_class.relforcerowsecurity` for a sample table) — a boot-time assertion that RLS is actually active in production.
- Alert if the app ever connects as an owner/superuser role in production.
- No credentials in logs.

## Acceptance criteria

- Given two tenants A and B with products, when a session connects as `kova_app` with `app.tenant_id = A` and runs a raw `SELECT * FROM products`, then no tenant B rows are returned.
- Given `app.tenant_id = A`, when an `INSERT`/`UPDATE` sets `tenant_id = B`, then Postgres rejects it via `WITH CHECK`.
- Given the production backend boots, when it queries `relforcerowsecurity` for a tenant table, then it is `true`, and the connection role is not an owner/superuser.
- Given the full existing test suite, when run with the app connecting as `kova_app` and RLS forced, then all 322 tests still pass.
- Given `alembic downgrade` of `0036`, then FORCE and the added `WITH CHECK` are removed and migrations remain reversible in CI.

## Verification commands

```bash
docker compose exec -T backend uv run ruff check
docker compose exec -T backend uv run alembic upgrade head
docker compose exec -T backend uv run alembic downgrade -1 && docker compose exec -T backend uv run alembic upgrade head   # reversibility
docker compose exec -T backend uv run pytest app/tests/test_rls_enforcement.py app/tests/test_tenant_isolation.py app/tests/test_tenant_isolation_routes.py -q
docker compose exec -T backend uv run pytest -q   # full regression as kova_app
```

## Definition of done

- App connects as a non-owner role in all environments; owner used only for migrations + documented bypass paths.
- `FORCE ROW LEVEL SECURITY` on every tenant-scoped table; write policies have `WITH CHECK`.
- `test_rls_enforcement.py` proves cross-tenant blocking and passes only when RLS is truly active.
- Full suite green under the new role; migration reversible.
- Boot-time RLS assertion + owner-connection alert in place.
- `docs/deployment.md` and ADR-009 updated to reflect RLS now enforced; the pre-beta RLS gate marked closed.

## Risks and mitigations

- **Risk:** missing a `GRANT` breaks a production query. **Mitigation:** run the full suite as `kova_app` before deploy; `ALTER DEFAULT PRIVILEGES`; staging soak.
- **Risk:** a no-context path silently returns zero rows in prod after RLS goes live. **Mitigation:** step 4 handles every such path with a test; boot-time assertion.
- **Risk:** Supabase pooler interaction with `set_config`. **Mitigation:** keep transaction-local `set_config`; verify on staging with pooler.
- **Risk:** role provisioning drift between environments. **Mitigation:** `provision_app_role.sql` checked in; CI provisions the same role.

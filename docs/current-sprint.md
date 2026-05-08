# Current Sprint

## Active Sprint

Sprint: 0A — Platform Skeleton

## Sprint Goal

Create the minimum deployable application skeleton.

## Allowed Work

Only work on:

- Repository structure
- Backend skeleton
- Frontend skeleton
- Docker/local dev
- PostgreSQL local dev setup
- Alembic setup
- Initial health endpoint
- Basic CI
- Basic staging deployment path or documented deployment path
- `.env.example`
- No-secrets baseline

## Explicitly Not Allowed This Sprint

Do not implement:

- Auth
- RBAC
- Tenant isolation
- Catalog
- Register
- Orders
- Payments
- Billing
- Offline sync
- Refunds
- Shifts
- Inventory
- Reporting
- Stripe
- Sentry, unless trivial placeholder setup is needed
- Product UI beyond app shell
- Any vertical-specific feature

## Required Specs

- `specs/shared/project_skeleton.md`
- `specs/shared/local_dev.md`

If these specs do not exist, create them before implementation.

## Required BDD / Test Scenarios

- App health check responds successfully.
- Frontend loads app shell.
- Backend connects to database.
- Alembic migration applies cleanly.
- CI runs backend tests.
- CI runs frontend checks.

## Sprint 0A Tasks

### Project Structure

- [ ] Create backend app folder.
- [ ] Create frontend app folder.
- [ ] Create docs folder.
- [ ] Create specs folder.
- [ ] Create ADR folder.
- [ ] Add README with local development instructions.

### Backend Skeleton

- [ ] Add FastAPI app skeleton.
- [ ] Add `/health` endpoint.
- [ ] Add app settings/config module.
- [ ] Add basic dependency structure.
- [ ] Add backend test framework.

### Frontend Skeleton

- [ ] Add React/TypeScript app skeleton.
- [ ] Add app shell.
- [ ] Add basic routing placeholder.
- [ ] Add frontend test framework.
- [ ] Add basic error boundary placeholder.

### Database / Migrations

- [ ] Add PostgreSQL local dev.
- [ ] Add Docker Compose.
- [ ] Add Alembic.
- [ ] Add initial migration.
- [ ] Add migration apply command.

### CI

- [ ] Add backend lint/test job.
- [ ] Add frontend lint/test/typecheck job.
- [ ] Add migration check job if feasible.
- [ ] Add no-secrets check if feasible.

### Environment

- [ ] Add `.env.example`.
- [ ] Ensure `.env` is ignored.
- [ ] Document required env vars.

### Deployment

- [ ] Add documented staging deployment path.
- [ ] Add health check verification in staging if environment exists.

## Definition of Ready

- Repo exists.
- Stack direction confirmed.
- Local development target confirmed.
- Hosting direction documented.
- No unresolved decision blocking the skeleton.

## Definition of Done

- App runs locally.
- Backend tests pass.
- Frontend checks pass.
- Migration applies locally.
- CI runs on PR.
- `.env.example` exists.
- No secrets are committed.
- Staging path exists or is documented.

## Notes

Do not skip Sprint 0A quality work to jump into product features.

The goal is to make future work safe and repeatable.

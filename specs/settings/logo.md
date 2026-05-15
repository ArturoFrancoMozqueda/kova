# Business Logo Setup

## Status

Draft. Required before implementing logo upload/configuration.

## Problem

Owners need the POS to feel like their business, but the current backend does not expose tenant logo storage or settings.

## Target Users

- Tenant owners
- Tenant managers

## Functional Requirements

- Owner or manager can upload or replace one business logo.
- Logo is stored as a tenant setting and scoped to the tenant.
- Logo appears in supported app surfaces once configured.
- If no logo exists, the app shows a neutral business initials fallback.

## Data Model Impact

Add a tenant-scoped settings model, for example:

- `tenant_settings`
  - `id`
  - `tenant_id`
  - `logo_url`
  - `created_at`
  - `updated_at`

The table must include `tenant_id`, RLS, and tenant isolation tests.

## API Impact

- `GET /api/v1/settings/tenant`
- `PATCH /api/v1/settings/tenant/logo`

Write endpoint requirements:

- Permission check
- Tenant scoping
- Audit log event `settings.logo.updated`
- Idempotency if the operation creates a stored asset record

## Acceptance Criteria

- Logo upload is not shown as a completed setup step until the backend exists.
- Tenant A cannot read or update Tenant B's logo.
- Unsupported file types and oversized files show clear errors.

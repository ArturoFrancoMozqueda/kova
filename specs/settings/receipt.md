# Receipt Settings

## Status

Implemented. Updated for P0 production fix on 2026-05-21.

## Problem

Owners must be able to open receipt settings during setup without seeing API 404s or console errors.
A fresh tenant may not have a persisted receipt settings row yet, but the UI still needs a valid
initial state so the owner can review and save the first receipt configuration.

## Target Users

- Tenant owners
- Tenant managers

## Functional Requirements

- `GET /api/v1/settings/receipt` returns existing tenant receipt settings when configured.
- If the tenant has no receipt settings row, the endpoint returns a valid initial tenant-scoped
  response using the tenant name as `receipt_business_name`.
- Owner or manager can save receipt business name, footer, tax/contact text, and logo URL.
- Receipt settings remain scoped to the authenticated tenant.

## Data Model Impact

Uses existing `tenant_receipt_settings`.

No migration is required for this fix.

## API Impact

- `GET /api/v1/settings/receipt`
- `PUT /api/v1/settings/receipt`

Write endpoint requirements:

- Permission check through `settings.manage`
- Tenant scoping through current membership
- Audit log event `settings.receipt.upsert`

## Offline Impact

No offline queue changes. Settings are online-only for beta.

## Error States

- Unauthenticated users receive `401`.
- Users without settings permission cannot update receipt settings.
- Fresh tenants receive an initial `200` response, not `404`.

## Acceptance Criteria

- Opening `/settings/receipt` does not produce console errors from missing receipt settings.
- Fresh tenants see either real receipt settings or a valid initial state.
- Saving receipt settings persists the values and writes an audit log.
- Tenant A cannot read or overwrite Tenant B receipt settings.


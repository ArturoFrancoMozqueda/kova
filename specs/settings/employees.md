# Employee Management

## Status

Draft. Required before implementing employee setup UI.

## Problem

The product needs employee setup as part of POS configuration, but the current frontend does not expose member invitation, listing, or deactivation flows.

## Target Users

- Tenant owners
- Tenant managers

## Functional Requirements

- Owner can invite an employee by email.
- Owner or manager can list active members.
- Owner or manager can deactivate a member.
- Roles remain limited to existing supported roles.
- Custom roles UI remains deferred.

## Data Model Impact

Use existing `users` and `memberships` where possible.

Additional tables may be needed for invitations:

- `membership_invitations`
  - `id`
  - `tenant_id`
  - `email`
  - `role`
  - `token_hash`
  - `expires_at`
  - `accepted_at`
  - `revoked_at`
  - `created_at`

Every tenant-scoped table must include `tenant_id` and RLS.

## API Impact

- `GET /api/v1/employees`
- `POST /api/v1/employees/invitations`
- `DELETE /api/v1/employees/{membership_id}`

Write endpoint requirements:

- Permission check
- Tenant scoping
- Idempotency where applicable
- Audit log events:
  - `employee.invited`
  - `employee.deactivated`
  - `employee.invitation.accepted`

## Acceptance Criteria

- Employee setup is not shown as a fake completed setup step until these APIs exist.
- Cashiers cannot invite or deactivate employees.
- Tenant isolation tests prove one business cannot see another business's members.

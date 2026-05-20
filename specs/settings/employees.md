# Employee Management

## Status

Implemented for the first beta employee setup path. Keep this spec updated when role permissions or
invitation acceptance behavior changes.

## Problem

The product needs employee setup as part of POS configuration. Owners and managers must understand
what each role can do before inviting staff, because assigning the wrong role can expose billing,
reports, configuration, or employee management to the wrong person.

## Target Users

- Tenant owners
- Tenant managers

## Functional Requirements

- Owner can invite an employee by email.
- Owner or manager can list active members.
- Owner or manager can deactivate a member.
- Roles remain limited to existing supported roles.
- Custom roles UI remains deferred.
- The employee settings screen explains each role in business language before invitation.
- The selected invitation role shows its permission meaning inline.

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
- Owner/manager sees localized role labels: Propietario, Gerente, Cajero.
- Owner/manager sees role descriptions before sending an invitation.

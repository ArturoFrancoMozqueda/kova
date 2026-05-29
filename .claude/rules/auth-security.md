---
paths:
  - "**/*auth*"
  - "**/*session*"
  - "**/*login*"
  - "**/*signup*"
  - "**/*tenant*"
  - "**/*rls*"
  - "**/middleware*"
  - "**/policies/**/*"
  - "**/migrations/**/*"
---

# Auth, Tenant Isolation, and Security Rules

Kova is multi-tenant SaaS software. Security regressions are product-breaking.

## Non-negotiables

- Do not weaken authentication, authorization, session handling, tenant isolation, or Supabase RLS.
- Preserve cookie-only session behavior unless the task explicitly asks for a reviewed auth architecture change.
- Do not move tokens into localStorage/sessionStorage.
- Do not expose access tokens, refresh tokens, Stripe secrets, service-role keys, database URLs, or webhook secrets.
- Do not log secrets, cookies, auth headers, payment payloads, or personally identifiable customer data.
- Do not bypass tenant filters for convenience.
- Do not disable RLS to fix a query.

## Database and RLS

Before touching tables, policies, or migrations:

1. Identify the tenant/company/business ownership model.
2. Inspect existing policies and helper functions.
3. Verify whether frontend uses anon role, backend uses service role, or both.
4. Preserve least privilege.
5. Add or update tests/manual QA notes for cross-tenant access risks.

## API behavior

- Backend endpoints must enforce ownership server-side.
- Frontend checks are UX only, never security.
- Do not trust client-provided tenant IDs without server-side verification.
- Avoid returning extra fields just because they are convenient.

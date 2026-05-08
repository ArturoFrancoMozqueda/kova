# ADR-007: Auth and Session Strategy

## Status

Accepted

## Context

The MVP used weaker auth patterns that are not ideal for production SaaS.

A real SaaS POS needs revocable sessions, secure cookie handling, and clear logout behavior.

## Decision

Use:

- httpOnly secure cookies
- short-lived access token/session
- refresh token stored as a hash in `sessions`
- refresh token rotation
- revocable sessions
- logout
- logout all sessions
- password reset
- email verification

## Consequences

### Positive

- Better XSS resistance than localStorage token storage.
- Sessions can be revoked.
- Security events can be audited.
- Better production readiness.

### Negative

- Cookie/CORS/CSRF handling requires care.
- More backend complexity.

## Rules

- Do not store sensitive auth tokens in localStorage.
- Refresh tokens are hashed at rest.
- Refresh token reuse should revoke the session family if possible.
- Auth events should be audited.

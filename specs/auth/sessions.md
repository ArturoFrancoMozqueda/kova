# Spec — Auth & Sessions (Sprint 0B)

## Problem Statement

The platform needs secure, revocable, multi-session authentication before any
product features can be built. Sessions must be tied to a tenant context so
every downstream request carries both identity and tenant scope.

## Flows

### Signup

1. Client posts `email`, `password`, `tenant_name`.
2. System creates `tenant`, `user`, `membership(role=owner)`.
3. System creates a `verification_token` (type: email_verification).
4. In `APP_ENV=local`: token returned in response (`dev_verification_token`).
5. In production: email sent (email service deferred; raise if called in prod).
6. Returns 201. User may not log in until email is verified.

### Email Verification

1. Client posts `token`.
2. System looks up token hash, checks not expired, not already used.
3. Marks `users.is_email_verified = true`, marks token used.
4. Returns 200.

### Login

1. Client posts `email`, `password`.
2. System checks user exists, is verified, is active.
3. System verifies password hash.
4. System creates `session` record.
5. Sets two httpOnly cookies:
   - `access_token`: signed JWT, 15-minute TTL.
   - `refresh_token`: opaque random token (stored hashed in sessions), 30-day TTL.
6. Logs `user.login` to audit_log.
7. Returns 200 + `UserResponse`.

### Refresh

1. Client sends request with `refresh_token` cookie.
2. System hashes the cookie value, looks up session by hash.
3. Checks session not revoked, not expired.
4. Rotates: generates new refresh token, updates `sessions.refresh_token_hash`.
5. Issues new `access_token` cookie.
6. Returns 200.

### Logout

1. Requires valid `access_token` cookie.
2. Revokes current session (`sessions.revoked_at = now()`).
3. Clears both cookies.
4. Returns 204.

### Logout-All

1. Requires valid `access_token` cookie.
2. Revokes all non-revoked sessions for the user.
3. Clears both cookies.
4. Returns 204.

### Password Reset — Request

1. Client posts `email`.
2. System creates `verification_token` (type: password_reset, 1-hour TTL).
3. Always returns 200 (don't leak whether email exists).
4. In `APP_ENV=local`: token returned in response (`dev_reset_token`).

### Password Reset — Confirm

1. Client posts `token`, `new_password`.
2. System validates token (not expired, not used, correct type).
3. Updates `users.hashed_password`.
4. Marks token used.
5. Revokes all sessions for that user.
6. Logs `user.password_reset` to audit_log.
7. Returns 200.

### Me

1. Requires valid `access_token` cookie.
2. Returns current user + tenant info.
3. Scoped to the tenant stored in the session.

## Token Design

### Access Token (JWT)

```
header: {"alg": "HS256", "typ": "JWT"}
payload: {
  "sub": "<user_id>",
  "tid": "<tenant_id>",
  "jti": "<session_id>",
  "iat": <unix_ts>,
  "exp": <unix_ts + 900>
}
```

Signed with `settings.secret_key`. Algorithm: HS256.

### Refresh Token

`secrets.token_urlsafe(32)` → stored as `hashlib.sha256(token).hexdigest()` in `sessions.refresh_token_hash`.

### Verification / Reset Token

`secrets.token_urlsafe(32)` → stored as SHA-256 hex in `verification_tokens.token_hash`.

## Cookie Settings

| Cookie | HttpOnly | Secure | SameSite | Path | Max-Age |
|---|---|---|---|---|---|
| `access_token` | True | env-driven | Lax | / | 900s |
| `refresh_token` | True | env-driven | Lax | /api/v1/auth | 2592000s |

`Secure=True` when `APP_ENV != local`.

## Data Model Impact

See migrations 0002 (users), 0004 (sessions, verification_tokens).

## API Impact

```
POST /api/v1/auth/signup
POST /api/v1/auth/verify
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/logout-all
POST /api/v1/auth/password-reset/request
POST /api/v1/auth/password-reset/confirm
GET  /api/v1/me
```

## Permissions Impact

All auth endpoints are public or require only a valid session (no RBAC permission).
`GET /api/v1/me` requires a valid session. No RBAC permission needed.

## Audit Log Behavior

| Event | Action | Resource |
|---|---|---|
| Signup | `user.signup` | user_id |
| Login | `user.login` | user_id |
| Logout | `user.logout` | session_id |
| Logout-all | `user.logout_all` | user_id |
| Password reset confirm | `user.password_reset` | user_id |

## Error States

| Condition | Status |
|---|---|
| Email already exists | 400 |
| Invalid credentials | 401 |
| Email not verified | 403 |
| Invalid / expired token | 400 |
| Session revoked | 401 |
| Session expired | 401 |

## Offline Impact

None. Auth endpoints are online-only.

## Idempotency

Signup is naturally idempotent on email: duplicate call returns 400.
Password-reset tokens are single-use.
Refresh token rotation is replay-safe: old token is invalidated on rotation.

## Test Matrix

| Scenario | Layer | Required By |
|---|---|---|
| Signup happy path | Integration | Beta |
| Duplicate email | Integration | Beta |
| Verify email | Integration | Beta |
| Login happy path | Integration | Beta |
| Login — wrong password | Integration | Beta |
| Login — unverified email | Integration | Beta |
| Refresh rotates token | Integration | Beta |
| Old refresh token rejected after rotation | Integration | Beta |
| Logout revokes session | Integration | Beta |
| Logout-all revokes all sessions | Integration | Beta |
| Password reset end-to-end | Integration | Beta |
| Me returns correct tenant | Integration | Beta |
| Unauthenticated → 401 | Integration | Beta |

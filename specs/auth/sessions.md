# Spec — Auth & Sessions (Sprint 0B)

## Problem Statement

The platform needs secure, revocable, multi-session authentication before any
product features can be built. Sessions must be tied to a tenant context so
every downstream request carries both identity and tenant scope.

## Flows

### Signup

1. Client posts `email`, `password`, `tenant_name`, and explicit `accepted_terms`.
2. Every accepted attempt pays one bcrypt hash before looking up the normalized email.
3. A new address creates `tenant`, `user`, and `membership(role=owner)` and sends a verification link.
   A pending address receives a fresh verification link, invalidating older links without changing its password.
   A verified address leaves its credentials and identity unchanged.
4. All three outcomes return **201** with the same Spanish message and `reason: "signup_received"`.
   Hosted environments always return `user_id`, `tenant_id`, and `dev_verification_token` as `null`.
   Only `APP_ENV=local` retains identity/token diagnostics for local development and tests.
5. Public responses never report whether an address exists or has been verified. Internal audit and
   server-authored conversion events retain the actual result; duplicates never record a new conversion.
6. The browser can try normal password login after any acknowledged signup. A failed login shows
   a neutral acknowledgement with sign-in, password-recovery, and resend actions. An unverified
   user may log in and operate; email verification remains mandatory at the paid boundary.
7. Per-IP and per-account rate limits remain in force. Uniform responses and bcrypt work do not
   promise identical network/provider timing; verification email delivery is a separate side effect.

### Email Verification

1. Client posts `token`.
2. System looks up token hash, checks not expired, not already used.
3. Marks `users.is_email_verified = true`, marks token used.
4. Returns 200.

### Login

1. Client posts `email`, `password`.
2. System checks user exists and is active. Verification is enforced for paid actions.
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

### Commercial access and offline continuity

`GET /auth/session` keeps identity separate from subscription eligibility and adds
`commercial_access: {allowed, reason, valid_until}`. Authentication remains available
for payment recovery and account export/deletion when commercial use is blocked.
The backend checks commercial eligibility on each protected business request.

The frontend redirects blocked owners to billing and asks employees to contact
their owner. A business API `402` closes open business views and revokes cached
offline permission without deleting queued sales. An open register also closes
at its server-granted deadline, including while disconnected.
An already-open session also requires a new online probe at least every 12 hours;
branding changes and network failures cannot extend that deadline.

Cold offline access requires an allowed, finite server grant and a cached catalog
for the same tenant. Its deadline is the earlier of 12 hours from verification
and the billing deadline. Legacy snapshots without billing permission fail closed.
Offline operation cannot receive a remote cancellation until reconnection; the
finite local grant bounds that limitation. No cached identity authorizes an API call.

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
| Signup accepted, including existing email | 201 |
| Invalid credentials | 401 |
| Email not verified at the paid boundary | 403 |
| Invalid / expired token | 400 |
| Session revoked | 401 |
| Session expired | 401 |

## Offline Impact

None. Auth endpoints are online-only.

## Idempotency

Signup is naturally idempotent on normalized email: duplicate calls return the same generic 201 acknowledgement without creating another identity.
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

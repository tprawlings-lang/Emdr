# 0006 — Stateless HMAC sessions

**Status:** Accepted

## Context
Sessions are signed HMAC-SHA256 tokens in an httpOnly/secure/SameSite cookie:
7-day idle (cookie maxAge) + 30-day absolute (signed issue timestamp). No
server-side session store.

## Decision
Keep stateless tokens for now. Revocation is achieved by the `status = 'active'`
check in `getCurrentUser`: suspending or deleting a user (which sets
`status='deleted'`) invalidates their token immediately.

## Consequences
- No per-session revocation or rotation, and no "log out everywhere." Adequate
  because there is no password-change flow yet and account-level revocation
  works.
- **Upgrade path (recommended before a managed-auth launch):** a `sessions`
  table (id, user_id, issued_at, revoked_at) or a per-user `token_epoch` bumped
  on password change / "sign out everywhere". Tracked as a launch gate in
  COMPLIANCE.md (managed auth provider).

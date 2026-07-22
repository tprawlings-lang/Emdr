# 0003 — Security headers & CSP

**Status:** Accepted

## Context
The app served HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and
`Referrer-Policy` but no Content-Security-Policy or Permissions-Policy.

## Decision
Add a CSP (`next.config.ts`): `default-src 'self'`, `object-src 'none'`,
`frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, and
`img-src 'self' data:`. `script-src`/`style-src` include `'unsafe-inline'`
because Next's App Router injects inline bootstrap without nonce middleware.
Add a Permissions-Policy disabling camera/mic/geo/payment/usb.

## Consequences
- Residual XSS surface is small: no third-party scripts, no user-authored HTML,
  React auto-escaping, no `dangerouslySetInnerHTML`.
- **Upgrade path:** move to a nonce-based `script-src` via request-time code
  (generate a per-request nonce, drop `'unsafe-inline'`). Deferred to avoid
  destabilizing the App Router streaming/render path pre-launch. *(Done in
  ADR 0008 — implemented in `src/proxy.ts`.)*

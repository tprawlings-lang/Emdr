# 0008 — Nonce-based Content-Security-Policy

**Status:** Accepted — supersedes the `'unsafe-inline'` script-src decision in
ADR 0003.

## Context
ADR 0003 shipped a static CSP with `script-src 'self' 'unsafe-inline'` because
Next.js emits inline bootstrap scripts and a static header (set in
`next.config.ts`) cannot carry a per-request nonce. `'unsafe-inline'` on
scripts is the one meaningful residual XSS vector — any injected inline
`<script>` would execute.

## Decision
Set the CSP per request in `src/proxy.ts` (Next 16's renamed `middleware`
convention) with a fresh nonce:
`script-src 'self' 'nonce-<random>' 'strict-dynamic'`, dropping
`'unsafe-inline'` from scripts. Next.js reads the CSP from the request header
and stamps the nonce onto the scripts it renders; `'strict-dynamic'` lets those
nonce'd scripts load their chunks without host allowlisting. The remaining
static headers (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
Permissions-Policy) stay in `next.config.ts`.

`style-src` keeps `'unsafe-inline'` deliberately: React/Next inject small inline
styles and there is no script-execution risk from a style attribute. The
inline-`<script>` vector is what the nonce closes.

## Consequences
- Injected inline scripts no longer execute — the primary reflected/stored-XSS
  payload shape is blocked even if an escaping bug slipped through.
- CSP is now computed in the proxy layer (runs in Next's edge/proxy layer and is
  bundled into the standalone server, so it applies on Render too).
- Regression guard: the e2e security-headers test asserts a nonce is present and
  `'unsafe-inline'` is absent from `script-src`; the authenticated + signup e2e
  flows exercise real hydration, so a broken nonce (which would block scripts)
  fails CI.
- Migrated to Next 16's `proxy` file convention (2026-07-22): `src/middleware.ts`
  → `src/proxy.ts`, `export function middleware` → `export function proxy`;
  `config`/`matcher` unchanged. Same per-request behaviour; deprecation warning
  gone. Build shows the route as `ƒ Proxy`.

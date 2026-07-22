import { NextRequest, NextResponse } from "next/server";

// Per-request nonce-based Content-Security-Policy (supersedes the static
// 'unsafe-inline' script-src from ADR 0003 → ADR 0008). Each response gets a
// fresh nonce; Next.js reads the CSP from the request header and stamps the
// nonce onto its own inline bootstrap scripts, so we can drop 'unsafe-inline'
// from script-src entirely. 'strict-dynamic' lets those nonce'd scripts load
// the chunks they need without host allowlisting.
//
// style-src keeps 'unsafe-inline' deliberately: React/Next inject small inline
// styles and there is no script-execution risk from styles. The meaningful XSS
// vector (inline <script>) is what the nonce closes.
//
// File convention: this is Next.js 16's `proxy` (the renamed `middleware`
// convention; see https://nextjs.org/docs/messages/middleware-to-proxy). Same
// per-request behavior — only the file + function names changed.
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Setting the CSP on the *request* headers is what makes Next.js apply the
  // nonce to the scripts it renders.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Run on all routes except static assets (which need no CSP nonce and would
  // only add latency). Keeps the header on every HTML/document response.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

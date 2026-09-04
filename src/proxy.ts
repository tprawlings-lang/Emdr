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
// THE DEVELOPMENT RELAXATION, AND WHY IT IS NARROW.
//
// React's development build calls eval() to reconstruct component stacks, and
// Next's dev server opens a websocket for hot reload. Under the production
// policy both are blocked with no visible error: the page renders, hydration
// never completes, and every "use client" component on the site is inert —
// buttons that do nothing, forms that never open. That is a silent failure mode
// which costs a developer an afternoon before they suspect the header, and it
// makes the one thing a browser is for — driving the app — impossible locally.
//
// So development adds exactly two things: 'unsafe-eval' to script-src and the
// dev websocket to connect-src. Nothing else moves. `isDev` is computed from
// NODE_ENV, which `next build` sets to "production" and cannot be talked out
// of, and a test asserts the production policy contains neither — because the
// only thing worse than a blocked dev environment is a relaxation that follows
// the build out the door.
const isDev = process.env.NODE_ENV !== "production";

/** The policy for one response. Exported so a test can read the production
 *  string directly rather than inferring it from a running server — a policy
 *  nobody can assert is a policy that drifts. */
export function contentSecurityPolicy(nonce: string, dev = isDev): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);

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

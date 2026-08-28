import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so the Docker image ships only traced files.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Security headers (compliance 2.1): TLS terminates at the platform edge;
  // HSTS and the basics are set here so they hold on any host. The
  // Content-Security-Policy is set per-request in src/proxy.ts instead,
  // because it carries a fresh nonce each response (ADR 0008).
  // Route migration to the Web GUI handoff §26 atlas.
  //
  // §26 allows route changes "only through an approved migration map", and the
  // map is the atlas itself. These are the retired addresses. They redirect
  // rather than 404 because a bookmarked clinician URL failing silently during
  // a review session is the kind of small breakage that costs trust in the
  // whole console.
  //
  // Permanent, because these addresses are not coming back. The old person
  // record and the old clinical record both live under /clinician/member/:id
  // now — the atlas has exactly one person address, and having three was the
  // "two mental models" defect handoff 05 §3.2 named.
  async redirects() {
    return [
      { source: "/clinician/work", destination: "/clinician/today", permanent: true },
      { source: "/clinician/clinical", destination: "/clinician/caseload", permanent: true },
      { source: "/clinician/clinical/:id", destination: "/clinician/member/:id/record", permanent: true },
      { source: "/clinician/people/:id", destination: "/clinician/member/:id", permanent: true },
      { source: "/clinician/audit", destination: "/review/audit", permanent: true },
      { source: "/clinician/autonomous", destination: "/review/autonomous", permanent: true },
      { source: "/clinician/bls", destination: "/review/bls", permanent: true },
      { source: "/clinician/testing", destination: "/review/testing", permanent: true },
      // Member surfaces moved under /app (§26). Two are renames as well as
      // moves: /dashboard is the atlas's Today, /practices its Activities.
      // Wave 2 builds what those screens should contain; this puts them at the
      // right address first so the rebuild happens in place.
      { source: "/dashboard", destination: "/app/today", permanent: true },
      { source: "/practices", destination: "/app/activities", permanent: true },
      { source: "/practices/:path*", destination: "/app/activities/:path*", permanent: true },
      { source: "/check-in", destination: "/app/check-in", permanent: true },
      { source: "/paths", destination: "/app/paths", permanent: true },
      { source: "/ground", destination: "/app/ground", permanent: true },
      { source: "/learn/:path*", destination: "/app/learn/:path*", permanent: true },
      { source: "/learn", destination: "/app/learn", permanent: true },
      { source: "/measures/:path*", destination: "/app/measures/:path*", permanent: true },
      { source: "/measures", destination: "/app/measures", permanent: true },
      { source: "/companion", destination: "/app/companion", permanent: true },
      { source: "/session/:path*", destination: "/app/session/:path*", permanent: true },
      { source: "/settings/:path*", destination: "/app/settings/:path*", permanent: true },
      // /settings never had an index page — it 404'd before the move too.
      // Wave 2 built the one §26 specifies, so this now forwards to a real
      // page rather than to the sub-page it was standing in for.
      { source: "/settings", destination: "/app/settings", permanent: true },
      { source: "/screening/:path*", destination: "/app/screening/:path*", permanent: true },
      { source: "/screening", destination: "/app/screening", permanent: true },
      { source: "/onboarding/:path*", destination: "/app/onboarding/:path*", permanent: true },
      { source: "/onboarding", destination: "/app/onboarding", permanent: true },
      // §26 gives review its own home; /review/audit is the only one built.
      { source: "/review", destination: "/review/audit", permanent: false },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

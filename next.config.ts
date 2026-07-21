import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so the Docker image ships only traced files.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Security headers (compliance 2.1): TLS terminates at the platform edge;
  // HSTS and the basics are set here so they hold on any host.
  async headers() {
    // Content-Security-Policy. 'unsafe-inline' on script/style is required by
    // Next's inline bootstrap without nonce middleware — the app ships no
    // third-party scripts and no user-authored HTML, so the residual XSS
    // surface is small. frame-ancestors 'none' supersedes X-Frame-Options.
    // Tightening to a nonce-based script-src is tracked in docs/adr/0003.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
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

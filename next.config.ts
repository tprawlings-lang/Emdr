import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so the Docker image ships only traced files.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  // Security headers (compliance 2.1): TLS terminates at the platform edge;
  // HSTS and the basics are set here so they hold on any host.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

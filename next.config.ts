import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output so the Docker image ships only traced files.
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;

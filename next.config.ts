import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hosted credentials come from the provider's environment, never local file traces.
  outputFileTracingExcludes: {
    "/*": ["./.env", "./.env.*", "./.data/**/*", "./broadcast/**/*"],
  },
  outputFileTracingIncludes: {
    "/api/demo/offline": ["./deployments/offline-demo.json"],
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config: NextConfig = {
  poweredByHeader: false,
  turbopack: { root: repositoryRoot },
  outputFileTracingRoot: repositoryRoot,
  experimental: { cpus: 2 },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;

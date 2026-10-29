import type { NextConfig } from "next";

// The agent (Express) runs separately. The browser talks to it through /backend, so
// pay links, sign-in and x402 payment headers stay same-origin with no CORS setup.
const AGENT_URL = process.env.FACTURA_AGENT_URL ?? "http://localhost:8402";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${AGENT_URL}/:path*` }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// The agent (Express) runs separately. The browser talks to it through /backend, so
// pay links, sign-in and x402 payment headers stay same-origin with no CORS setup.
const AGENT_URL = process.env.FACTURA_AGENT_URL ?? "http://localhost:8402";

// On Vercel there is no agent on localhost: without this the whole API silently 404s.
if (process.env.VERCEL_ENV === "production" && !process.env.FACTURA_AGENT_URL) {
  throw new Error(
    "FACTURA_AGENT_URL is not set. Deploy the agent (see agent/Dockerfile) and set FACTURA_AGENT_URL to its public URL in the Vercel project settings.",
  );
}

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

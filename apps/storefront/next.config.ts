import { loadStorefrontEnv } from "@fluxkit/config";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Keep in sync with defaultLocale in @fluxkit/ui (this file runs in plain Node and cannot import the bundler-built package).
const DEFAULT_LOCALE = "uk";

/**
 * `phase` is the Next.js phase, not NODE_ENV: it is `phase-development-server` only for `next dev`.
 *
 * The `/store/*` rewrite exists for local development only (ADR 0026). In every deployed environment an edge reverse
 * proxy routes `/store/*` to the API and sets `X-Forwarded-For` itself; a Next rewrite would leave the API without the
 * real client address (docs/plans/2026-10-18-storefront.md, "Runtime test of the dev rewrite"), so it is never emitted
 * for a production build or server.
 */
export default function config(phase: string): NextConfig {
  return {
    reactStrictMode: true,
    async redirects() {
      return [{ source: "/", destination: `/${DEFAULT_LOCALE}`, permanent: false }];
    },
    async rewrites() {
      if (phase !== PHASE_DEVELOPMENT_SERVER) return [];
      // Throws (no fallback) when API_INTERNAL_URL is missing or malformed, so `next dev` stops instead of proxying nowhere.
      const { apiInternalUrl } = loadStorefrontEnv(process.env);
      return [{ source: "/store/:path*", destination: `${apiInternalUrl}/store/:path*` }];
    },
  };
}

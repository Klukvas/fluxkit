import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadStorefrontEnv } from "@fluxkit/config";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants.js";

// Keep in sync with defaultLocale in @fluxkit/ui (this file runs in plain Node and cannot import the bundler-built package).
const DEFAULT_LOCALE = "uk";

/**
 * Reads the repository's root `.env` (the file the API reads, README quick start) for `next dev` and `next start`, so one
 * file configures both apps. Variables already set in the shell win, as with `node --env-file`. A missing file is normal
 * (production sets real variables); a malformed variable still fails in `loadStorefrontEnv`. `next build` never reads it,
 * so a build does not depend on runtime settings. It is not done with `node --env-file`: Next copies the flags of the
 * Node process into `NODE_OPTIONS` of its workers, and Node refuses `--env-file` there.
 */
export function loadRootEnvFile(phase: string, file = resolve(process.cwd(), "../../.env")): void {
  if (phase !== PHASE_DEVELOPMENT_SERVER && phase !== PHASE_PRODUCTION_SERVER) return;
  if (existsSync(file)) process.loadEnvFile(file);
}

/**
 * `phase` is the Next.js phase, not NODE_ENV: it is `phase-development-server` only for `next dev`.
 *
 * The `/store/*` rewrite exists for local development only (ADR 0026). In every deployed environment an edge reverse
 * proxy routes `/store/*` to the API and sets `X-Forwarded-For` itself; a Next rewrite would leave the API without the
 * real client address (docs/plans/2026-10-18-storefront.md, "Runtime test of the dev rewrite"), so it is never emitted
 * for a production build or server.
 */
export default function config(phase: string): NextConfig {
  loadRootEnvFile(phase);
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

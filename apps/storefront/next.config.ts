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
  // Read once, here, by `next build` (the CSP headers are stored in the build output, so changing the CSP list needs a
  // rebuild) and again by `next start` (the image optimizer's allow-list). No API_INTERNAL_URL exists at build time; a
  // placeholder satisfies the shared parser, only `imageHosts` is read. A malformed list stops the build or the server
  // here, loudly (README, "Images").
  const { imageHosts } = loadStorefrontEnv({
    API_INTERNAL_URL: "http://127.0.0.1",
    STOREFRONT_IMAGE_HOSTS: process.env.STOREFRONT_IMAGE_HOSTS,
  });
  return {
    reactStrictMode: true,
    // `next start` evaluates this file again, so the optimizer allows the hosts of the variable as the server STARTS; the
    // pages read the same variable (`lib/image-hosts.server.ts`) and so agree with it. The CSP below keeps the build value.
    images: {
      remotePatterns: imageHosts.map((hostname) => ({ protocol: "https" as const, hostname })),
    },
    async redirects() {
      return [{ source: "/", destination: `/${DEFAULT_LOCALE}`, permanent: false }];
    },
    async headers() {
      return headerRules({ development: phase === PHASE_DEVELOPMENT_SERVER, imageHosts });
    },
    async rewrites() {
      if (phase !== PHASE_DEVELOPMENT_SERVER) return [];
      // Throws (no fallback) when API_INTERNAL_URL is missing or malformed, so `next dev` stops instead of proxying nowhere.
      const { apiInternalUrl } = loadStorefrontEnv(process.env);
      return [{ source: "/store/:path*", destination: `${apiInternalUrl}/store/:path*` }];
    },
  };
}

/**
 * Security headers of the storefront (plan 2026-10-18-storefront.md, "Security", owner answer 13). This file runs in plain
 * Node from `next.config.ts`, so it imports nothing from the bundler-built workspace packages.
 *
 * The policy has no nonces: nonces would make every page dynamic and uncacheable, so Next's inline bootstrap scripts are
 * allowed with `'unsafe-inline'`. That is acceptable only because the storefront loads no third-party script and renders no
 * HTML from the API; the CSP is the second line behind that rule, not the first.
 */

export interface SecurityHeadersOptions {
  /** `next dev`: adds `'unsafe-eval'` (React's development call stacks) and the hot-reload websocket. */
  development: boolean;
  /** Host names from `STOREFRONT_IMAGE_HOSTS`, already validated by `loadStorefrontEnv`. */
  imageHosts: readonly string[];
}

export interface HeaderEntry {
  key: string;
  value: string;
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function buildContentSecurityPolicy(options: SecurityHeadersOptions): string {
  for (const host of options.imageHosts) {
    // A defence in depth: a host is spliced into a header, so it must be a bare DNS name.
    if (!HOSTNAME.test(host)) {
      throw new RangeError(
        "An image host must be a bare host name (no scheme, port, path or wildcard).",
      );
    }
  }
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(options.development ? ["'unsafe-eval'"] : []),
  ];
  const connectSources = ["'self'", ...(options.development ? ["ws:", "wss:"] : [])];
  const imageSources = ["'self'", "data:", ...options.imageHosts.map((host) => `https://${host}`)];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSources],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", imageSources],
    ["connect-src", connectSources],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/**
 * The pages that show a guest order's access token (it lives in their URL fragment): `/{locale}/order/{number}`. They send
 * no `Referer` at all. A fragment is never part of a `Referer` anyway; this also hides the order number and keeps the rule
 * strict should a later change ever put something secret into the path.
 */
export const TOKEN_PAGE_SOURCE = "/:locale/order/:path*";

/**
 * Every header rule, in order. Next applies all rules that match a path and the LAST one wins for a repeated key, so the
 * order page's `no-referrer` comes after the site-wide policy.
 */
export function headerRules(
  options: SecurityHeadersOptions,
): { source: string; headers: HeaderEntry[] }[] {
  return [
    { source: "/:path*", headers: securityHeaders(options) },
    { source: TOKEN_PAGE_SOURCE, headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
  ];
}

export function securityHeaders(options: SecurityHeadersOptions): HeaderEntry[] {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // The guest order page overrides this with `no-referrer` (its URL fragment never leaves the browser, but be strict).
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // Only where HTTPS is certain: a browser would otherwise pin http://localhost for a year. Browsers ignore it over HTTP.
    ...(options.development
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
  ];
}

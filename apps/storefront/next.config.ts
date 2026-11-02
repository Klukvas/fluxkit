import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadStorefrontEnv } from "@fluxkit/config";
import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";

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
 * The marker every placeholder legal text carries (`src/config/legal.ts` `LEGAL_PLACEHOLDER_MARKER`; a spec keeps the two
 * equal: this file runs in plain Node and cannot import the app's source).
 */
export const LEGAL_MARKER = "TODO(fluxkit): replace with the shop's own legal text";

/**
 * The release check of a client fork (privacy plan step 10, owner answer 10): with `STOREFRONT_REQUIRE_LEGAL_TEXT=true` a
 * production build REFUSES while ANY legal placeholder remains: a `legal.*` message of any language that still carries the
 * placeholder marker (the intro of every legal page does, so the shop cannot pass without replacing the texts themselves), or
 * a controller identity value (`src/config/legal-identity.json`) that is missing, `null`, empty or blank. Each offender is
 * named. Master builds without the variable (it ships placeholders), so its CI and e2e builds are unaffected. Fails closed:
 * when asked to check and the messages or the identity file cannot be read, the build stops.
 */
export const LEGAL_IDENTITY_FIELDS = [
  "shopLegalName",
  "shopLegalAddress",
  "privacyContact",
  "lastUpdated",
] as const;

export function assertNoLegalPlaceholders(options: {
  enabled: boolean;
  messagesDir: string;
  identityFile: string;
}): void {
  if (!options.enabled) return;
  if (!existsSync(options.messagesDir)) {
    throw new Error(
      `STOREFRONT_REQUIRE_LEGAL_TEXT is set but the messages directory was not found (${options.messagesDir}).`,
    );
  }
  if (!existsSync(options.identityFile)) {
    throw new Error(
      `STOREFRONT_REQUIRE_LEGAL_TEXT is set but the legal identity file was not found (${options.identityFile}).`,
    );
  }
  const found: string[] = [];
  const files = readdirSync(options.messagesDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const file of files) {
    const messages = JSON.parse(readFileSync(resolve(options.messagesDir, file), "utf8")) as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(messages)) {
      if (key.startsWith("legal.") && typeof value === "string" && value.includes(LEGAL_MARKER)) {
        found.push(`${file}: ${key}`);
      }
    }
  }
  const identity = JSON.parse(readFileSync(options.identityFile, "utf8")) as Record<
    string,
    unknown
  >;
  const unset = LEGAL_IDENTITY_FIELDS.filter((field) => {
    const value = identity[field];
    return typeof value !== "string" || value.trim() === "";
  });
  const problems: string[] = [];
  if (found.length > 0) {
    problems.push(`these messages still carry the placeholder marker:\n${found.join("\n")}`);
  }
  if (unset.length > 0) {
    problems.push(
      `these legal identity values in ${options.identityFile} are still unset or empty:\n${unset.join("\n")}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      "A production build with STOREFRONT_REQUIRE_LEGAL_TEXT=true needs the shop's own legal texts and identity, but " +
        problems.join("\n"),
    );
  }
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
  if (phase === PHASE_PRODUCTION_BUILD) {
    assertNoLegalPlaceholders({
      enabled: process.env.STOREFRONT_REQUIRE_LEGAL_TEXT === "true",
      messagesDir: resolve(process.cwd(), "src/messages"),
      identityFile: resolve(process.cwd(), "src/config/legal-identity.json"),
    });
  }
  // Read once, here, by `next build` (the CSP headers are stored in the build output, so changing the CSP list needs a
  // rebuild) and again by `next start` (the image optimizer's allow-list). No API_INTERNAL_URL exists at build time; a
  // placeholder satisfies the shared parser, only `imageHosts` is read. A malformed list stops the build or the server
  // here, loudly (README, "Images").
  const { imageHosts } = loadStorefrontEnv({
    API_INTERNAL_URL: "http://127.0.0.1",
    STOREFRONT_IMAGE_HOSTS: process.env.STOREFRONT_IMAGE_HOSTS,
  });
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    // DEVELOPMENT ONLY (owner decision 2026-11-01, option a of docs/plans/2026-11-01-demo-images-local-run.md): the API's
    // media prefix, inlined for `next dev` so pages render local uploads as `/media/<key>` (rewritten below). Never set for
    // a production build or server; `lib/image-source.ts` also ignores it unless NODE_ENV is development.
    ...(development ? developmentMediaEnv() : {}),
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
      return [
        { source: "/store/:path*", destination: `${apiInternalUrl}/store/:path*` },
        // Uploaded images of the local API (development only, see `env` above).
        { source: "/media/:path*", destination: `${apiInternalUrl}/media/:path*` },
      ];
    },
  };
}

/**
 * The API's media prefix for `next dev`: `MEDIA_PUBLIC_BASE_URL` (the same root `.env` as the API) or, unset, the API's
 * own development default `API_INTERNAL_URL` + `/media`. A malformed `MEDIA_PUBLIC_BASE_URL` stops the dev server without
 * repeating it. Without a valid `API_INTERNAL_URL` there is no prefix here: the `/store` rewrite stops the dev server
 * with that variable's own error.
 */
function developmentMediaEnv(): { env?: Record<string, string> } {
  const base = developmentMediaBaseUrl();
  return base === undefined ? {} : { env: { FLUXKIT_DEV_MEDIA_BASE_URL: base } };
}

function developmentMediaBaseUrl(): string | undefined {
  const configured = process.env.MEDIA_PUBLIC_BASE_URL;
  if (configured !== undefined && configured !== "") {
    let url: URL | undefined;
    try {
      url = new URL(configured);
    } catch {
      url = undefined;
    }
    if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
      throw new Error("MEDIA_PUBLIC_BASE_URL must be an absolute http(s) URL (see .env.example).");
    }
    return configured.replace(/\/+$/, "");
  }
  const internal = process.env.API_INTERNAL_URL;
  if (internal === undefined || internal === "") return undefined;
  const { apiInternalUrl } = loadStorefrontEnv(process.env);
  return `${apiInternalUrl}/media`;
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
 * The payment return page (ADR 0032 decision 6): the provider sends the shopper back to `/{locale}/payment/return?payment=<id>`.
 * The id is an attempt reference, not a secret, but the page belongs to one order, so it sends no `Referer` either.
 */
export const PAYMENT_RETURN_PAGE_SOURCE = "/:locale/payment/return";

/**
 * The three pages of the emailed links (email plan step 10): forgot password, reset password and verify email. The last two
 * read a bearer token from their URL fragment; all three send no `Referer`, so nothing about the visit (the address, that
 * a reset was asked for) reaches another site.
 */
export const ACCOUNT_EMAIL_PAGE_SOURCE =
  "/:locale/account/:page(forgot-password|reset-password|verify-email)";

/**
 * Every header rule, in order. Next applies all rules that match a path and the LAST one wins for a repeated key, so the
 * `no-referrer` rules (the order page, the emailed-link pages) come after the site-wide policy.
 */
export function headerRules(
  options: SecurityHeadersOptions,
): { source: string; headers: HeaderEntry[] }[] {
  return [
    { source: "/:path*", headers: securityHeaders(options) },
    { source: TOKEN_PAGE_SOURCE, headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    {
      source: ACCOUNT_EMAIL_PAGE_SOURCE,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
    {
      source: PAYMENT_RETURN_PAGE_SOURCE,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    },
  ];
}

export function securityHeaders(options: SecurityHeadersOptions): HeaderEntry[] {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // The guest order page, the payment return page and the emailed-link pages override this with `no-referrer` (their URL fragments never leave the
    // browser, but be strict).
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    // Only where HTTPS is certain: a browser would otherwise pin http://localhost for a year. Browsers ignore it over HTTP.
    ...(options.development
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
  ];
}

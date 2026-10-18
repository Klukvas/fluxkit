import { z } from "zod";

/** Public origin used when `STOREFRONT_PUBLIC_URL` is unset and `NODE_ENV` is not production (the storefront dev port). */
export const DEFAULT_STOREFRONT_PUBLIC_URL = "http://localhost:3001";

/** Blank counts as unset, so `FOO=` in a `.env` file behaves like no line at all. */
function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/**
 * An `http(s)` origin: no path, query, fragment or credentials. Returns it without a trailing slash. The messages never
 * include the value, because a URL may carry a password.
 */
function originUrl(variable: string) {
  return z.string().transform((value, context) => {
    const trimmed = value.trim();
    let url: URL | undefined;
    try {
      url = new URL(trimmed);
    } catch {
      url = undefined;
    }
    const valid =
      url !== undefined &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      !trimmed.includes("?") &&
      !trimmed.includes("#");
    if (url === undefined || !valid) {
      context.addIssue({
        code: "custom",
        message: `${variable} must be an http(s) origin without path, query, fragment or credentials, for example http://127.0.0.1:3000`,
      });
      return z.NEVER;
    }
    return url.origin;
  });
}

/** One DNS name: dot-separated labels of letters, digits and inner hyphens. No scheme, port, path, wildcard or space. */
const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOSTNAME_LENGTH = 253;

function isHostname(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_HOSTNAME_LENGTH &&
    value.split(".").every((label) => HOSTNAME_LABEL.test(label))
  );
}

const imageHosts = z.string().transform((value, context) => {
  const hosts = value.split(",").map((host) => host.trim().toLowerCase());
  if (!hosts.every(isHostname)) {
    context.addIssue({
      code: "custom",
      message:
        "STOREFRONT_IMAGE_HOSTS must be a comma-separated list of host names only (no scheme, port, path or wildcard), for example cdn.example.com",
    });
    return z.NEVER;
  }
  return [...new Set(hosts)];
});

const storefrontEnvSchema = z
  .object({
    API_INTERNAL_URL: z.preprocess(blankToUndefined, originUrl("API_INTERNAL_URL")),
    STOREFRONT_PUBLIC_URL: z.preprocess(
      blankToUndefined,
      originUrl("STOREFRONT_PUBLIC_URL").optional(),
    ),
    STOREFRONT_IMAGE_HOSTS: z.preprocess(blankToUndefined, imageHosts.optional()),
    NODE_ENV: z.string().optional(),
  })
  .superRefine((env, context) => {
    const isProduction = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
    if (isProduction && env.STOREFRONT_PUBLIC_URL === undefined) {
      context.addIssue({
        code: "custom",
        path: ["STOREFRONT_PUBLIC_URL"],
        message:
          "is required when NODE_ENV is production (the public origin, for example https://shop.example)",
      });
    }
  });

export interface StorefrontEnv {
  /** Origin where the Next server reaches the API (server-side fetches and the development rewrite); no trailing slash. */
  apiInternalUrl: string;
  /** Public origin of the storefront for canonical URLs, hreflang, sitemap and JSON-LD; no trailing slash. */
  storefrontPublicUrl: string;
  /** Lower-case host names allowed for image optimisation and `img-src`; empty means none. */
  imageHosts: string[];
}

/**
 * Validates and normalizes the storefront's environment variables. Throws with a readable message that names the
 * variables but never echoes their values. Reads only its own variables (and `NODE_ENV`), so the storefront does not
 * need the API's secrets.
 */
export function loadStorefrontEnv(source: Record<string, string | undefined>): StorefrontEnv {
  const parsed = storefrontEnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid storefront environment: ${details}`);
  }
  const env = parsed.data;
  return {
    apiInternalUrl: env.API_INTERNAL_URL,
    storefrontPublicUrl: env.STOREFRONT_PUBLIC_URL ?? DEFAULT_STOREFRONT_PUBLIC_URL,
    imageHosts: env.STOREFRONT_IMAGE_HOSTS ?? [],
  };
}

import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseEnabledFeatures } from "./features.js";

/** Lowercase letters, 2 to 8, optional `-` segments (`uk`, `en`, `en-us`). */
const LOCALE_CODE = /^[a-z]{2,8}(-[a-z]{2,8})*$/;
const localeCode = z
  .string()
  .regex(LOCALE_CODE, "must be a lowercase locale code such as uk or en-us");

/** Defaults of `DEFAULT_LOCALE` and `LOCALES`; also used by tests and tools that build an app without an environment. */
export const DEFAULT_LOCALE = "uk";
export const DEFAULT_LOCALES: readonly string[] = ["uk", "en"];

/**
 * Defaults of the admin session limits. They equal `SESSION_DEFAULTS` of `@fluxkit/core` (a test in apps/api asserts it);
 * this package does not depend on core, so the numbers are repeated here on purpose.
 */
export const DEFAULT_ADMIN_SESSION_IDLE_MINUTES = 720;
export const DEFAULT_ADMIN_SESSION_MAX_HOURS = 168;
/** One year: a larger value is almost certainly a typo and would only postpone session expiry to "never". */
const MAX_ADMIN_SESSION_IDLE_MINUTES = 525_600;
const MAX_ADMIN_SESSION_MAX_HOURS = 8_760;

/**
 * Defaults and bounds of the customer session limits (ADR 0016). They equal `CUSTOMER_SESSION_DEFAULTS` and
 * `SESSION_BOUNDS` of `@fluxkit/core` (a test in apps/api asserts it). The bounds are the admin ones: one year.
 */
export const DEFAULT_CUSTOMER_SESSION_IDLE_MINUTES = 43_200;
export const DEFAULT_CUSTOMER_SESSION_MAX_HOURS = 2_160;
const MAX_CUSTOMER_SESSION_IDLE_MINUTES = 525_600;
const MAX_CUSTOMER_SESSION_MAX_HOURS = 8_760;

/** Default and upper bound of the cart lifetime in days (ADR 0015). A year is the longest a cart is worth keeping. */
export const DEFAULT_CART_TTL_DAYS = 30;
const MAX_CART_TTL_DAYS = 365;

/**
 * Defaults and bounds of the order variables (ADR 0017). They equal `ORDER_PAYMENT_TTL_MINUTES` and `GUEST_ACCESS_DAYS` of
 * `@fluxkit/core` (a test in apps/api asserts it); this package does not depend on core, so the numbers are repeated here.
 */
export const DEFAULT_ORDER_PAYMENT_TTL_MINUTES = 30;
const MIN_ORDER_PAYMENT_TTL_MINUTES = 5;
const MAX_ORDER_PAYMENT_TTL_MINUTES = 1440;
export const DEFAULT_ORDER_GUEST_ACCESS_DAYS = 90;
const MAX_ORDER_GUEST_ACCESS_DAYS = 3650;

/**
 * Shortest `ORDER_TOKEN_SECRET`. Equals `GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH` of `@fluxkit/core` (a test in apps/api
 * asserts it); this package does not depend on core, so the number is repeated here.
 */
export const ORDER_TOKEN_SECRET_MIN_LENGTH = 32;

/**
 * Defaults and bounds of `TRUST_PROXY`, the number of reverse-proxy hops in front of the API. 0 trusts none, so the
 * client address is the socket address. More than 10 hops is a typo: every extra trusted hop lets a client choose more
 * of its own address.
 */
export const DEFAULT_TRUST_PROXY = 0;
const MAX_TRUST_PROXY = 10;

/**
 * Default and upper bound of `MAX_OPEN_ORDERS`: unpaid (`awaiting_payment`) orders one guest email or one customer may hold
 * at a time (ADR 0024). A larger number is not a limit on stock hoarding any more.
 */
export const DEFAULT_MAX_OPEN_ORDERS = 3;
const MAX_MAX_OPEN_ORDERS = 50;

/** Defaults and bounds of the in-process scheduler (ADR 0018): a tick every 10 seconds to every hour. */
export const DEFAULT_SCHEDULER_ENABLED = true;
export const DEFAULT_SCHEDULER_INTERVAL_SECONDS = 60;
const MIN_SCHEDULER_INTERVAL_SECONDS = 10;
const MAX_SCHEDULER_INTERVAL_SECONDS = 3600;

/**
 * Defaults of the pricing variables, and the currencies a shop can sell in. The list equals `CURRENCY_CODES` of
 * `@fluxkit/core` (a test in apps/api asserts it); this package does not depend on core, so it is repeated here.
 */
export const DEFAULT_SHOP_CURRENCY = "UAH";
export const DEFAULT_PRICES_INCLUDE_TAX = true;
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const SUPPORTED_SHOP_CURRENCIES: readonly string[] = [
  "UAH",
  "USD",
  "EUR",
  "PLN",
  "GBP",
  "CZK",
  "CHF",
  "CAD",
  "JPY",
  "KWD",
];
/** Same bound as the largest on-hand quantity of `@fluxkit/core`: a larger threshold is a typo, not a policy. */
const MAX_LOW_STOCK_THRESHOLD = 1_000_000_000;

/**
 * Defaults and bounds of the media variables (ADR 0028 decision 8). They equal `MEDIA_LIMITS` of `@fluxkit/core` (a test in
 * apps/api asserts it); this package does not depend on core, so the numbers are repeated here.
 */
export const MEDIA_STORAGE_DRIVERS = ["local", "none"] as const;
export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number];
export const DEFAULT_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const MIN_MEDIA_MAX_BYTES = 1024;
const MAX_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MEDIA_MAX_PIXELS = 50_000_000;
const MIN_MEDIA_MAX_PIXELS = 1;
const MAX_MEDIA_MAX_PIXELS = 100_000_000;

/**
 * Where uploads go outside production: `<repo>/var/media`, which `.gitignore` lists. Built from the location of this file
 * (the same depth in `src/` and in `dist/`), the way the API finds the feature packages. Only a path is computed here; the
 * directory is neither read nor created, the API checks it at start. It is a function, and plain path segments instead of
 * `new URL("...", import.meta.url)`, because the storefront bundles this package and its bundler would try to resolve that
 * URL form as a file asset and fail the build.
 */
function defaultMediaDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "var", "media");
}

/** Exactly `true` or `false`: a typo in a security flag must fail loudly, not fall back to a default. */
const strictBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

/** Plain decimal digits only (no sign, exponent, hex, spaces or decimals), within 1..max. */
function positiveInteger(max: number) {
  return z
    .string()
    .regex(/^[1-9][0-9]*$/, "must be a positive whole number")
    .transform(Number)
    .pipe(z.number().max(max, `must be at most ${max}`));
}

/** Plain decimal digits only (no sign, exponent, hex, spaces, decimals or leading zeros), within 0..max. */
function nonNegativeInteger(max: number) {
  return z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/, "must be a non-negative whole number")
    .transform(Number)
    .pipe(z.number().max(max, `must be at most ${max}`));
}

/** An absolute path without a NUL byte, and not the file system root (an upload directory is never `/`). Returned normalized. */
const mediaDirectory = z
  .string()
  .refine((value) => !value.includes("\0") && isAbsolute(value), {
    message: "must be an absolute path",
  })
  .transform((value) => resolve(value))
  .refine((value) => resolve(value, "..") !== value, {
    message: "must not be the file system root",
  });

/**
 * The URL prefix of stored uploads. Written in normalized form on purpose: stored URLs are compared with this text as a
 * prefix (attach marking, ADR 0028 decision 5), so `HTTPS://Host`, a default port or a dot segment would never match.
 * The messages are fixed text: the value may carry credentials and must not reach a log.
 */
const mediaPublicBaseUrl = z.string().superRefine((value, context) => {
  const problem = describeBaseUrlProblem(value);
  if (problem !== undefined) {
    context.addIssue({ code: "custom", message: problem });
  }
});

function describeBaseUrlProblem(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "must be an absolute http or https URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "must be an absolute http or https URL";
  }
  if (url.username !== "" || url.password !== "" || /^[a-z]+:\/\/[^/]*@/i.test(value)) {
    return "must not contain credentials";
  }
  if (value.includes("?") || value.includes("#")) {
    return "must not contain a query or a fragment";
  }
  if (value.endsWith("/")) {
    return "must not end with a slash";
  }
  const normalized = url.pathname === "/" ? url.origin : url.href;
  if (normalized !== value) {
    return "must be written in normalized form (lower-case scheme and host, no default port, no dot segments)";
  }
  return undefined;
}

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    FEATURES_ENABLED: z.string().optional(),
    FEATURES_DIR: z.string().min(1).optional(),
    DEFAULT_LOCALE: localeCode.default(DEFAULT_LOCALE),
    LOCALES: z
      .string()
      .default(DEFAULT_LOCALES.join(","))
      .transform((value) => value.split(",").map((locale) => locale.trim()))
      .pipe(z.array(localeCode).min(1)),
    ADMIN_COOKIE_SECURE: strictBoolean.default(true),
    ADMIN_SESSION_IDLE_MINUTES: positiveInteger(MAX_ADMIN_SESSION_IDLE_MINUTES).default(
      DEFAULT_ADMIN_SESSION_IDLE_MINUTES,
    ),
    ADMIN_SESSION_MAX_HOURS: positiveInteger(MAX_ADMIN_SESSION_MAX_HOURS).default(
      DEFAULT_ADMIN_SESSION_MAX_HOURS,
    ),
    STORE_COOKIE_SECURE: strictBoolean.default(true),
    CUSTOMER_SESSION_IDLE_MINUTES: positiveInteger(MAX_CUSTOMER_SESSION_IDLE_MINUTES).default(
      DEFAULT_CUSTOMER_SESSION_IDLE_MINUTES,
    ),
    CUSTOMER_SESSION_MAX_HOURS: positiveInteger(MAX_CUSTOMER_SESSION_MAX_HOURS).default(
      DEFAULT_CUSTOMER_SESSION_MAX_HOURS,
    ),
    CART_TTL_DAYS: positiveInteger(MAX_CART_TTL_DAYS).default(DEFAULT_CART_TTL_DAYS),
    ORDER_PAYMENT_TTL_MINUTES: positiveInteger(MAX_ORDER_PAYMENT_TTL_MINUTES)
      .pipe(
        z
          .number()
          .min(MIN_ORDER_PAYMENT_TTL_MINUTES, `must be at least ${MIN_ORDER_PAYMENT_TTL_MINUTES}`),
      )
      .default(DEFAULT_ORDER_PAYMENT_TTL_MINUTES),
    ORDER_GUEST_ACCESS_DAYS: positiveInteger(MAX_ORDER_GUEST_ACCESS_DAYS).default(
      DEFAULT_ORDER_GUEST_ACCESS_DAYS,
    ),
    // No default and no trimming: a secret that is silently weak or silently altered is worse than a refusal to start.
    ORDER_TOKEN_SECRET: z
      .string()
      .min(
        ORDER_TOKEN_SECRET_MIN_LENGTH,
        `must be at least ${ORDER_TOKEN_SECRET_MIN_LENGTH} characters`,
      )
      .optional(),
    MAX_OPEN_ORDERS: positiveInteger(MAX_MAX_OPEN_ORDERS).default(DEFAULT_MAX_OPEN_ORDERS),
    TRUST_PROXY: nonNegativeInteger(MAX_TRUST_PROXY).default(DEFAULT_TRUST_PROXY),
    NODE_ENV: z.string().optional(),
    SCHEDULER_ENABLED: strictBoolean.default(DEFAULT_SCHEDULER_ENABLED),
    SCHEDULER_INTERVAL_SECONDS: positiveInteger(MAX_SCHEDULER_INTERVAL_SECONDS)
      .pipe(
        z
          .number()
          .min(
            MIN_SCHEDULER_INTERVAL_SECONDS,
            `must be at least ${MIN_SCHEDULER_INTERVAL_SECONDS}`,
          ),
      )
      .default(DEFAULT_SCHEDULER_INTERVAL_SECONDS),
    SHOP_CURRENCY: z
      .string()
      .refine((value) => SUPPORTED_SHOP_CURRENCIES.includes(value), {
        message: `must be one of ${SUPPORTED_SHOP_CURRENCIES.join(", ")} (upper case, exact)`,
      })
      .default(DEFAULT_SHOP_CURRENCY),
    PRICES_INCLUDE_TAX: strictBoolean.default(DEFAULT_PRICES_INCLUDE_TAX),
    LOW_STOCK_THRESHOLD: nonNegativeInteger(MAX_LOW_STOCK_THRESHOLD).default(
      DEFAULT_LOW_STOCK_THRESHOLD,
    ),
    // No default here: in production the driver must be named, outside production `local` is applied in `loadEnv`.
    MEDIA_STORAGE_DRIVER: z.enum(MEDIA_STORAGE_DRIVERS).optional(),
    MEDIA_DIR: mediaDirectory.optional(),
    MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl.optional(),
    MEDIA_MAX_BYTES: positiveInteger(MAX_MEDIA_MAX_BYTES)
      .pipe(z.number().min(MIN_MEDIA_MAX_BYTES, `must be at least ${MIN_MEDIA_MAX_BYTES}`))
      .default(DEFAULT_MEDIA_MAX_BYTES),
    MEDIA_MAX_PIXELS: positiveInteger(MAX_MEDIA_MAX_PIXELS)
      .pipe(z.number().min(MIN_MEDIA_MAX_PIXELS, `must be at least ${MIN_MEDIA_MAX_PIXELS}`))
      .default(DEFAULT_MEDIA_MAX_PIXELS),
  })
  .superRefine((env, context) => {
    const inProduction = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
    if (inProduction && env.MEDIA_STORAGE_DRIVER === undefined) {
      context.addIssue({
        code: "custom",
        path: ["MEDIA_STORAGE_DRIVER"],
        message: `is required when NODE_ENV is production (${MEDIA_STORAGE_DRIVERS.join(" or ")}); there is no silent fallback to local disk`,
      });
    }
    if (inProduction && env.MEDIA_STORAGE_DRIVER === "local") {
      if (env.MEDIA_DIR === undefined) {
        context.addIssue({
          code: "custom",
          path: ["MEDIA_DIR"],
          message: "is required when MEDIA_STORAGE_DRIVER is local and NODE_ENV is production",
        });
      }
      if (env.MEDIA_PUBLIC_BASE_URL === undefined) {
        context.addIssue({
          code: "custom",
          path: ["MEDIA_PUBLIC_BASE_URL"],
          message: "is required when MEDIA_STORAGE_DRIVER is local and NODE_ENV is production",
        });
      }
    }
    if (inProduction && env.MEDIA_PUBLIC_BASE_URL?.startsWith("https://") === false) {
      context.addIssue({
        code: "custom",
        path: ["MEDIA_PUBLIC_BASE_URL"],
        message: "must use https when NODE_ENV is production",
      });
    }
    if ((env.NODE_ENV ?? "").trim().toLowerCase() === "production" && !env.ORDER_TOKEN_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["ORDER_TOKEN_SECRET"],
        message: `is required when NODE_ENV is production (at least ${ORDER_TOKEN_SECRET_MIN_LENGTH} characters)`,
      });
    }
    if (new Set(env.LOCALES).size !== env.LOCALES.length) {
      context.addIssue({
        code: "custom",
        path: ["LOCALES"],
        message: "must not contain duplicate locales",
      });
    }
    if (!env.LOCALES.includes(env.DEFAULT_LOCALE)) {
      context.addIssue({
        code: "custom",
        path: ["DEFAULT_LOCALE"],
        message: `"${env.DEFAULT_LOCALE}" must be one of LOCALES (${env.LOCALES.join(",")})`,
      });
    }
  });

export interface AppEnv {
  databaseUrl: string;
  redisUrl: string | undefined;
  port: number;
  enabledFeatures: string[];
  featuresDir: string | undefined;
  /** Locale that every translated text must contain (ADR 0006 decision 1). */
  defaultLocale: string;
  /** Locales accepted in translated texts; contains `defaultLocale`. */
  locales: string[];
  /** `Secure` flag of the admin session cookie. Only `false` for local plain-HTTP development. */
  adminCookieSecure: boolean;
  /** Admin session is closed after this many idle minutes. */
  adminSessionIdleMinutes: number;
  /** Absolute admin session lifetime in hours. */
  adminSessionMaxHours: number;
  /** `Secure` flag of the customer session cookie. Only `false` for local plain-HTTP development. */
  storeCookieSecure: boolean;
  /** Customer session is closed after this many idle minutes. */
  customerSessionIdleMinutes: number;
  /** Absolute customer session lifetime in hours. */
  customerSessionMaxHours: number;
  /** A cart expires this many days after its last write; also the `Max-Age` of the guest cart cookie. */
  cartTtlDays: number;
  /** An order waits this many minutes for payment before it expires and gives its stock back (5 to 1440). */
  orderPaymentTtlMinutes: number;
  /** A guest can open their order with its access token for this many days (1 to 3650). */
  orderGuestAccessDays: number;
  /**
   * Secret of the derived guest access tokens (ADR 0023); at least 32 characters. Required when `NODE_ENV` is
   * production; the API refuses to start without it in every environment. Never log it.
   */
  orderTokenSecret: string | undefined;
  /** Unpaid (`awaiting_payment`) orders one guest email or one customer may hold at once (1 to 50); ADR 0024. */
  maxOpenOrders: number;
  /**
   * Number of trusted reverse-proxy hops in front of the API (0 to 10), the value of Express `trust proxy`. 0 means the
   * client address is the socket address. Set the exact hop count: too high lets clients spoof `X-Forwarded-For` and
   * dodge the rate limits, too low keeps every shopper in the proxy's window.
   */
  trustProxy: number;
  /** Whether this API process runs the scheduler (order expiry, stock sweep, cleanup, event dispatch). */
  schedulerEnabled: boolean;
  /** Seconds between scheduler ticks (10 to 3600). */
  schedulerIntervalSeconds: number;
  /** The one currency the shop sells in (ISO 4217, upper case). An active variant needs a price in it. */
  shopCurrency: string;
  /** Whether stored prices already include tax; only exposed to the storefront, no tax is calculated. */
  pricesIncludeTax: boolean;
  /** `low_stock` when the available quantity is above 0 and at most this many. */
  lowStockThreshold: number;
  /** Where uploaded images are stored (ADR 0028): `local` disk, or `none` (uploads off, URL entry only). */
  mediaStorageDriver: MediaStorageDriver;
  /**
   * Absolute, normalized upload directory. Set with `local` (default `<repo>/var/media` outside production); with `none`
   * only when given. The parser does not touch the file system: the API checks that it exists and is writable.
   */
  mediaDir: string | undefined;
  /**
   * URL prefix of every stored upload, without a trailing slash (`<prefix>/<key>`). Set with `local` (default
   * `http://127.0.0.1:<PORT>/media` outside production; `https` required in production); with `none` only when given.
   * Changing it later does not rewrite stored URLs.
   */
  mediaPublicBaseUrl: string | undefined;
  /** Largest accepted upload in bytes (1 KiB to 50 MiB). */
  mediaMaxBytes: number;
  /** Largest accepted input width times height (1 to 100 000 000). */
  mediaMaxPixels: number;
}

/** Validates and normalizes process environment variables. Throws with a readable message on invalid input. */
export function loadEnv(source: Record<string, string | undefined>): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  const env = parsed.data;
  // Production without a driver was refused above, so the `local` default only ever applies outside production.
  const mediaStorageDriver = env.MEDIA_STORAGE_DRIVER ?? "local";
  const usesLocalDisk = mediaStorageDriver === "local";
  return {
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    port: env.PORT,
    enabledFeatures: parseEnabledFeatures(env.FEATURES_ENABLED),
    featuresDir: env.FEATURES_DIR,
    defaultLocale: env.DEFAULT_LOCALE,
    locales: env.LOCALES,
    adminCookieSecure: env.ADMIN_COOKIE_SECURE,
    adminSessionIdleMinutes: env.ADMIN_SESSION_IDLE_MINUTES,
    adminSessionMaxHours: env.ADMIN_SESSION_MAX_HOURS,
    storeCookieSecure: env.STORE_COOKIE_SECURE,
    customerSessionIdleMinutes: env.CUSTOMER_SESSION_IDLE_MINUTES,
    customerSessionMaxHours: env.CUSTOMER_SESSION_MAX_HOURS,
    cartTtlDays: env.CART_TTL_DAYS,
    orderPaymentTtlMinutes: env.ORDER_PAYMENT_TTL_MINUTES,
    orderGuestAccessDays: env.ORDER_GUEST_ACCESS_DAYS,
    orderTokenSecret: env.ORDER_TOKEN_SECRET,
    maxOpenOrders: env.MAX_OPEN_ORDERS,
    trustProxy: env.TRUST_PROXY,
    schedulerEnabled: env.SCHEDULER_ENABLED,
    schedulerIntervalSeconds: env.SCHEDULER_INTERVAL_SECONDS,
    shopCurrency: env.SHOP_CURRENCY,
    pricesIncludeTax: env.PRICES_INCLUDE_TAX,
    lowStockThreshold: env.LOW_STOCK_THRESHOLD,
    mediaStorageDriver,
    mediaDir: env.MEDIA_DIR ?? (usesLocalDisk ? defaultMediaDirectory() : undefined),
    mediaPublicBaseUrl:
      env.MEDIA_PUBLIC_BASE_URL ??
      (usesLocalDisk ? `http://127.0.0.1:${env.PORT}/media` : undefined),
    mediaMaxBytes: env.MEDIA_MAX_BYTES,
    mediaMaxPixels: env.MEDIA_MAX_PIXELS,
  };
}

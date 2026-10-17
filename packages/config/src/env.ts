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
  })
  .superRefine((env, context) => {
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
  /** The one currency the shop sells in (ISO 4217, upper case). An active variant needs a price in it. */
  shopCurrency: string;
  /** Whether stored prices already include tax; only exposed to the storefront, no tax is calculated. */
  pricesIncludeTax: boolean;
  /** `low_stock` when the available quantity is above 0 and at most this many. */
  lowStockThreshold: number;
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
    shopCurrency: env.SHOP_CURRENCY,
    pricesIncludeTax: env.PRICES_INCLUDE_TAX,
    lowStockThreshold: env.LOW_STOCK_THRESHOLD,
  };
}

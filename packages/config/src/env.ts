import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  DEFAULT_EMAIL_PROVIDER,
  EMAIL_PROVIDER_CHOICES,
  parseMailboxVariable,
  TEST_ONLY_EMAIL_PROVIDERS,
  type EmailMailbox,
  type EmailProviderChoice,
} from "./email.js";
import { parseEnabledFeatures } from "./features.js";
import {
  DEFAULT_MEILI_INDEX_PREFIX,
  describeMeiliUrlProblem,
  isPrivateMeiliHost,
  isValidMeiliApiKey,
  MEILI_INDEX_PREFIX_PATTERN,
  normalizeMeiliUrl,
  type SearchEnv,
} from "./search.js";
import {
  MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER,
  parsePaymentProvidersVariable,
  TEST_ONLY_PAYMENT_PROVIDERS,
} from "./payments.js";
import {
  parseEnabledShippingProviders,
  TEST_ONLY_SHIPPING_PROVIDERS,
} from "./shipping-providers.js";
import { blankToUndefined, DEFAULT_STOREFRONT_PUBLIC_URL, originUrl } from "./storefront-env.js";

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
/** The longest retention period of order contact data (core `retentionCutoff` refuses more). */
const MAX_ORDER_CONTACT_RETENTION_DAYS = 36_500;
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

/** The mailbox of `EMAIL_FROM` / `EMAIL_REPLY_TO`: the rules of core `parseMailbox`. The message never contains the value. */
function mailboxVariable(variable: string) {
  return z.string().transform((value, context): EmailMailbox => {
    const mailbox = parseMailboxVariable(value);
    if (mailbox === undefined) {
      context.addIssue({
        code: "custom",
        message: `${variable} must be one address or "Display Name <address>" (ASCII address, at most 200 characters, no control characters, no quotes or angle brackets inside the name)`,
      });
      return z.NEVER;
    }
    return mailbox;
  });
}

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
    SHIPPING_PROVIDERS_ENABLED: z.string().optional(),
    // The list is checked in `superRefine` (a problem names the rule, never an entry); no value means no online payment.
    PAYMENT_PROVIDERS_ENABLED: z.string().optional(),
    // Blank counts as unset, like the storefront variables. Exact values only: a typo must not silently mean `none`.
    EMAIL_PROVIDER: z.preprocess(
      (value) => (typeof value === "string" ? blankToUndefined(value.trim()) : value),
      z
        .enum(EMAIL_PROVIDER_CHOICES, {
          error: `must be one of ${EMAIL_PROVIDER_CHOICES.join(", ")} (lower case, exact)`,
        })
        .optional(),
    ),
    EMAIL_FROM: z.preprocess(blankToUndefined, mailboxVariable("EMAIL_FROM").optional()),
    EMAIL_REPLY_TO: z.preprocess(blankToUndefined, mailboxVariable("EMAIL_REPLY_TO").optional()),
    STOREFRONT_PUBLIC_URL: z.preprocess(
      blankToUndefined,
      originUrl("STOREFRONT_PUBLIC_URL").optional(),
    ),
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
    // No default (ADR 0033 decision 8): unset keeps order contact data without a period and job 12 off; the owner sets it
    // with an accountant. TODO(fluxkit): legal review of the period per market.
    ORDER_CONTACT_RETENTION_DAYS: positiveInteger(MAX_ORDER_CONTACT_RETENTION_DAYS).optional(),
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
    // Catalog search (ADR 0034 decision 9). The MEILI_* values are checked in `superRefine` and only when search is on, so
    // a deployment without search is not affected by them; a message never contains a value (URL or key).
    SEARCH_ENABLED: strictBoolean.default(false),
    MEILI_URL: z.preprocess(blankToUndefined, z.string().optional()),
    MEILI_API_KEY: z.preprocess(blankToUndefined, z.string().optional()),
    MEILI_INDEX_PREFIX: z.preprocess(blankToUndefined, z.string().optional()),
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
    if (inProduction && env.SHIPPING_PROVIDERS_ENABLED !== undefined) {
      const enabled = env.SHIPPING_PROVIDERS_ENABLED.split(",").map((part) =>
        part.trim().toLowerCase(),
      );
      for (const code of TEST_ONLY_SHIPPING_PROVIDERS.filter((test) => enabled.includes(test))) {
        context.addIssue({
          code: "custom",
          path: ["SHIPPING_PROVIDERS_ENABLED"],
          message: `"${code}" is a test-only provider (made-up pickup points and waybills) and is refused when NODE_ENV is production`,
        });
      }
    }
    const payments = parsePaymentProvidersVariable(env.PAYMENT_PROVIDERS_ENABLED);
    if (!payments.ok) {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDERS_ENABLED"],
        message: payments.problem,
      });
    } else if (payments.codes.length > 0) {
      for (const code of TEST_ONLY_PAYMENT_PROVIDERS.filter((test) =>
        payments.codes.includes(test),
      )) {
        if (inProduction) {
          context.addIssue({
            code: "custom",
            path: ["PAYMENT_PROVIDERS_ENABLED"],
            message: `"${code}" is a test-only provider (it charges nothing) and is refused when NODE_ENV is production`,
          });
        }
      }
      if (env.ORDER_PAYMENT_TTL_MINUTES < MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER) {
        context.addIssue({
          code: "custom",
          path: ["ORDER_PAYMENT_TTL_MINUTES"],
          message: `must be at least ${MIN_ORDER_PAYMENT_TTL_MINUTES_WITH_PAYMENT_PROVIDER} when PAYMENT_PROVIDERS_ENABLED names a provider (the invoice ends 3 minutes before the order and must leave 5 minutes to pay, so no order could be paid online with a shorter time)`,
        });
      }
      if (inProduction && env.STOREFRONT_PUBLIC_URL === undefined) {
        context.addIssue({
          code: "custom",
          path: ["STOREFRONT_PUBLIC_URL"],
          message:
            "is required when PAYMENT_PROVIDERS_ENABLED names a provider and NODE_ENV is production (the origin of the return and webhook addresses, for example https://shop.example)",
        });
      }
      if (inProduction && env.STOREFRONT_PUBLIC_URL?.startsWith("https://") === false) {
        context.addIssue({
          code: "custom",
          path: ["STOREFRONT_PUBLIC_URL"],
          message:
            "must use https when PAYMENT_PROVIDERS_ENABLED names a provider and NODE_ENV is production (the return and webhook addresses are built from it)",
        });
      }
    }
    const emailProvider = env.EMAIL_PROVIDER ?? DEFAULT_EMAIL_PROVIDER;
    if (inProduction && TEST_ONLY_EMAIL_PROVIDERS.includes(emailProvider)) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_PROVIDER"],
        message: `"${emailProvider}" is a test-only provider (it delivers nothing) and is refused when NODE_ENV is production`,
      });
    }
    if (emailProvider !== DEFAULT_EMAIL_PROVIDER) {
      if (env.EMAIL_FROM === undefined) {
        context.addIssue({
          code: "custom",
          path: ["EMAIL_FROM"],
          message: `is required when EMAIL_PROVIDER is not ${DEFAULT_EMAIL_PROVIDER} (the sender address, for example Shop Name <orders@shop.example>)`,
        });
      }
      if (inProduction && env.STOREFRONT_PUBLIC_URL === undefined) {
        context.addIssue({
          code: "custom",
          path: ["STOREFRONT_PUBLIC_URL"],
          message: `is required when EMAIL_PROVIDER is not ${DEFAULT_EMAIL_PROVIDER} and NODE_ENV is production (the origin every link in a mail starts with, for example https://shop.example)`,
        });
      }
      if (inProduction && env.STOREFRONT_PUBLIC_URL?.startsWith("https://") === false) {
        context.addIssue({
          code: "custom",
          path: ["STOREFRONT_PUBLIC_URL"],
          message: `must use https when EMAIL_PROVIDER is not ${DEFAULT_EMAIL_PROVIDER} and NODE_ENV is production (links in mail carry reset and verification tokens)`,
        });
      }
    }
    if (env.SEARCH_ENABLED) {
      if (env.MEILI_URL === undefined) {
        context.addIssue({
          code: "custom",
          path: ["MEILI_URL"],
          message:
            "is required when SEARCH_ENABLED is true (the engine's base URL, for example http://127.0.0.1:7700)",
        });
      } else {
        const problem = describeMeiliUrlProblem(env.MEILI_URL);
        if (problem !== undefined) {
          context.addIssue({ code: "custom", path: ["MEILI_URL"], message: problem });
        } else if (
          inProduction &&
          !env.MEILI_URL.startsWith("https://") &&
          !isPrivateMeiliHost(new URL(env.MEILI_URL).hostname)
        ) {
          context.addIssue({
            code: "custom",
            path: ["MEILI_URL"],
            message:
              "must use https or a private address when NODE_ENV is production (the engine must not be reached over the public internet in plain http)",
          });
        }
      }
      if (env.MEILI_API_KEY === undefined) {
        context.addIssue({
          code: "custom",
          path: ["MEILI_API_KEY"],
          message:
            "is required when SEARCH_ENABLED is true (a key scoped to the index prefix, see README, never the master key)",
        });
      } else if (!isValidMeiliApiKey(env.MEILI_API_KEY)) {
        context.addIssue({
          code: "custom",
          path: ["MEILI_API_KEY"],
          message: "must be 16 to 256 visible ASCII characters (no spaces)",
        });
      }
      if (
        env.MEILI_INDEX_PREFIX !== undefined &&
        !MEILI_INDEX_PREFIX_PATTERN.test(env.MEILI_INDEX_PREFIX)
      ) {
        context.addIssue({
          code: "custom",
          path: ["MEILI_INDEX_PREFIX"],
          message: `must match ${MEILI_INDEX_PREFIX_PATTERN.source} (lower case, ending with an underscore, at most 33 characters)`,
        });
      }
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
  /** Codes from `SHIPPING_PROVIDERS_ENABLED`; the API loads exactly these provider packages (ADR 0029 decision 8). */
  enabledShippingProviders: string[];
  /**
   * Codes from `PAYMENT_PROVIDERS_ENABLED` (ADR 0032 decision 16); the API loads exactly these provider packages. Empty
   * (the default) means no online payment: orders are paid by hand as before. `fake` is test-only and refused in
   * production; with a provider `ORDER_PAYMENT_TTL_MINUTES` is at least 8.
   */
  enabledPaymentProviders: string[];
  /**
   * `EMAIL_PROVIDER` (ADR 0031): `none` (default) loads no provider and no mail is sent; `resend` or `fake` names the one
   * provider package the API loads. `fake` is test-only and refused in production.
   */
  emailProvider: EmailProviderChoice;
  /** `EMAIL_FROM`; set whenever `emailProvider` is not `none`. The display name is the shop name in mail. */
  emailFrom: EmailMailbox | undefined;
  /** `EMAIL_REPLY_TO`, optional. */
  emailReplyTo: EmailMailbox | undefined;
  /**
   * `STOREFRONT_PUBLIC_URL` as the API reads it: the ONLY origin of links in mail (never a request header), without a
   * trailing slash. Outside production it defaults to the storefront's dev origin; in production it is undefined only
   * when `emailProvider` is `none` and the variable is unset, and `https` is required once a provider is configured.
   */
  storefrontPublicUrl: string | undefined;
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
   * Days after an order closed (or its newest refund) before job 12 anonymises its contact data (1 to 36 500); with it, job
   * 12 also purges old privacy requests and audit events. Unset: job 12 is off (ADR 0033 decision 8).
   */
  orderContactRetentionDays?: number;
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
   * URL prefix of every stored upload, without a trailing slash (`<prefix>/<key>`), and the prefix attach marking looks
   * for. Default `http://127.0.0.1:<PORT>/media` outside production with either driver; in production required with
   * `local` (`https`), and with `none` set only when given. Changing it later does not rewrite stored URLs.
   */
  mediaPublicBaseUrl: string | undefined;
  /** Largest accepted upload in bytes (1 KiB to 50 MiB). */
  mediaMaxBytes: number;
  /** Largest accepted input width times height (1 to 100 000 000). */
  mediaMaxPixels: number;
  /**
   * Catalog search (ADR 0034): off by default; then nothing of `MEILI_*` is read, no client exists, the search routes
   * answer 404 and nothing is enqueued. On: the engine URL, the scoped key (never logged) and the index prefix.
   */
  search: SearchEnv;
}

function searchEnv(env: {
  SEARCH_ENABLED: boolean;
  MEILI_URL?: string | undefined;
  MEILI_API_KEY?: string | undefined;
  MEILI_INDEX_PREFIX?: string | undefined;
}): SearchEnv {
  // Both are present when search is on: the schema refused anything else.
  if (!env.SEARCH_ENABLED || env.MEILI_URL === undefined || env.MEILI_API_KEY === undefined) {
    return { enabled: false };
  }
  return {
    enabled: true,
    meiliUrl: normalizeMeiliUrl(env.MEILI_URL),
    meiliApiKey: env.MEILI_API_KEY,
    indexPrefix: env.MEILI_INDEX_PREFIX ?? DEFAULT_MEILI_INDEX_PREFIX,
  };
}

/** The list was validated by the schema; an invalid one cannot get here. */
function enabledPaymentProviders(raw: string | undefined): string[] {
  const parsed = parsePaymentProvidersVariable(raw);
  return parsed.ok ? parsed.codes : [];
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
  const inProduction = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  return {
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    port: env.PORT,
    enabledFeatures: parseEnabledFeatures(env.FEATURES_ENABLED),
    featuresDir: env.FEATURES_DIR,
    enabledShippingProviders: parseEnabledShippingProviders(env.SHIPPING_PROVIDERS_ENABLED),
    enabledPaymentProviders: enabledPaymentProviders(env.PAYMENT_PROVIDERS_ENABLED),
    emailProvider: env.EMAIL_PROVIDER ?? DEFAULT_EMAIL_PROVIDER,
    emailFrom: env.EMAIL_FROM,
    emailReplyTo: env.EMAIL_REPLY_TO,
    storefrontPublicUrl:
      env.STOREFRONT_PUBLIC_URL ?? (inProduction ? undefined : DEFAULT_STOREFRONT_PUBLIC_URL),
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
    ...(env.ORDER_CONTACT_RETENTION_DAYS === undefined
      ? {}
      : { orderContactRetentionDays: env.ORDER_CONTACT_RETENTION_DAYS }),
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
    // Also with `none`: attach marking must keep recognising uploads stored earlier under this prefix (step 9 review M-2).
    // In production `local` requires the variable, so the localhost default only ever applies outside production.
    mediaPublicBaseUrl:
      env.MEDIA_PUBLIC_BASE_URL ??
      (inProduction ? undefined : `http://127.0.0.1:${env.PORT}/media`),
    mediaMaxBytes: env.MEDIA_MAX_BYTES,
    mediaMaxPixels: env.MEDIA_MAX_PIXELS,
    search: searchEnv(env),
  };
}

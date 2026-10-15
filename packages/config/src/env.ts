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
  };
}

/*
 * LiqPay plugin configuration (ADR 0059). Read once when the provider module is created; missing or malformed keys stop
 * startup with a message that names the variable and never its value. No URL variable: origins are constants.
 */

export const LIQPAY_API_ORIGIN = "https://www.liqpay.ua";

export const LIQPAY_PATHS = Object.freeze({
  checkout: "/api/3/checkout",
  request: "/api/request",
} as const);

export type LiqPayPath = (typeof LIQPAY_PATHS)[keyof typeof LIQPAY_PATHS];

/** API version sent on every signed payload (public docs v7). */
export const LIQPAY_VERSION = 7;

export const LIQPAY_CURRENCY = "UAH" as const;

export interface LiqPayConfig {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** Visible ASCII keys (format UNKNOWN until S1; refuse empty and controls). */
const KEY_PATTERN = /^[\x21-\x7E]{8,256}$/;

export class LiqPayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiqPayConfigError";
  }
}

function parseKey(
  env: Readonly<Record<string, string | undefined>>,
  name: "LIQPAY_PUBLIC_KEY" | "LIQPAY_PRIVATE_KEY",
): string {
  const value = env[name]?.trim() ?? "";
  if (value === "") {
    throw new LiqPayConfigError(
      `${name} is required when liqpay is in PAYMENT_PROVIDERS_ENABLED. See .env.example.`,
    );
  }
  if (!KEY_PATTERN.test(value)) {
    throw new LiqPayConfigError(
      `${name} must be 8 to 256 visible ASCII characters without spaces (the value is not shown).`,
    );
  }
  return value;
}

export function parseLiqPayEnv(env: Readonly<Record<string, string | undefined>>): LiqPayConfig {
  return Object.freeze({
    publicKey: parseKey(env, "LIQPAY_PUBLIC_KEY"),
    privateKey: parseKey(env, "LIQPAY_PRIVATE_KEY"),
  });
}

export function validateIntegrationSecret(field: string, value: string): string | undefined {
  if (field === "public_key") {
    try {
      parseKey({ LIQPAY_PUBLIC_KEY: value }, "LIQPAY_PUBLIC_KEY");
      return undefined;
    } catch (error) {
      if (error instanceof LiqPayConfigError) return error.message;
      throw error;
    }
  }
  if (field === "private_key") {
    try {
      parseKey({ LIQPAY_PRIVATE_KEY: value }, "LIQPAY_PRIVATE_KEY");
      return undefined;
    } catch (error) {
      if (error instanceof LiqPayConfigError) return error.message;
      throw error;
    }
  }
  return "Unknown secret field.";
}
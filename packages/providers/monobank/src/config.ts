/*
 * The plugin's own configuration (ADR 0032 decisions 14 to 16; payments plan step 7). Read once, when the provider module
 * is created; a missing or malformed token stops the API's startup with a message that names the variable and never its
 * value. There is no URL variable: the API origin is one constant (test and production tokens use the same host, M1 and
 * M2), so nothing configurable can point the plugin at another host (no SSRF). The token decides test or production.
 */

/** Monobank's API origin (M1; the OpenAPI spec's only server). The only host the plugin calls. */
export const MONOBANK_API_ORIGIN = "https://api.monobank.ua";

/** The routes the plugin calls (M3, M6, M13, M14, M12). Fixed paths; only `invoiceId` is ever added as a query value. */
export const MONOBANK_PATHS = Object.freeze({
  create: "/api/merchant/invoice/create",
  status: "/api/merchant/invoice/status",
  cancel: "/api/merchant/invoice/cancel",
  remove: "/api/merchant/invoice/remove",
  pubkey: "/api/merchant/pubkey",
} as const);

export type MonobankPath = (typeof MONOBANK_PATHS)[keyof typeof MONOBANK_PATHS];

/** The header that carries the token on every call (M1). Lower case, as `fetch` sends header names. */
export const MONOBANK_TOKEN_HEADER = "x-token";

export interface MonobankConfig {
  readonly token: string;
}

/**
 * The token's shape (ADR 0032 decision 16): 20 to 256 visible ASCII characters. Monobank documents no format (UNKNOWN;
 * S1 may widen the rule), so the check only refuses what cannot be a token: empty, a pasted line with spaces or quotes of
 * another alphabet, a control character.
 */
const TOKEN_PATTERN = /^[\x21-\x7E]{20,256}$/;

export class MonobankConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonobankConfigError";
  }
}

/**
 * `MONOBANK_TOKEN` (required when `monobank` is in `PAYMENT_PROVIDERS_ENABLED`). Throws `MonobankConfigError`; the
 * message names the variable and the rule, never the value or a part of it.
 */
export function parseMonobankEnv(
  env: Readonly<Record<string, string | undefined>>,
): MonobankConfig {
  const token = env.MONOBANK_TOKEN?.trim() ?? "";
  if (token === "") {
    throw new MonobankConfigError(
      "MONOBANK_TOKEN is required when monobank is in PAYMENT_PROVIDERS_ENABLED. See .env.example.",
    );
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new MonobankConfigError(
      "MONOBANK_TOKEN must be 20 to 256 visible ASCII characters without spaces (the value is not shown).",
    );
  }
  return Object.freeze({ token });
}

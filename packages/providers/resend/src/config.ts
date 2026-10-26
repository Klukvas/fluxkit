/*
 * The plugin's own configuration (ADR 0031 decisions 12 and 17; email plan step 6). Read once, when the provider module
 * is created; a missing or malformed key stops the API's startup with a message that names the variable and never its
 * value. There is no URL variable: the endpoint is one constant, so nothing configurable can point the plugin at another
 * host (no SSRF). Resend documents no other region or base URL (R17).
 */

/** Resend's API origin (plan R1). The only host the plugin calls. */
export const RESEND_API_ORIGIN = "https://api.resend.com";

/** The one route the plugin calls (plan R1). */
export const RESEND_SEND_PATH = "/emails";

/**
 * Sent on every request: Resend refuses a request without a `User-Agent` with `403` (R6). A generic product token, no
 * shop or client name (AGENTS.md section 15).
 */
export const RESEND_USER_AGENT = "fluxkit-provider-resend/1";

export interface ResendConfig {
  readonly apiKey: string;
}

/**
 * The key's shape (ADR 0031 decision 12): `re_` (R1 shows `Bearer re_...`) followed by 16 to 256 visible ASCII
 * characters. Resend documents no further format, so the check only refuses what cannot be a key (empty, a pasted line
 * with spaces, quotes of another alphabet, another service's key).
 */
const API_KEY_PATTERN = /^re_[\x21-\x7E]{16,256}$/;

export class ResendConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResendConfigError";
  }
}

/**
 * `RESEND_API_KEY` (required when `EMAIL_PROVIDER=resend`). Throws `ResendConfigError`; the message names the variable
 * and the rule, never the value or a part of it.
 */
export function parseResendEnv(env: Readonly<Record<string, string | undefined>>): ResendConfig {
  const key = env.RESEND_API_KEY?.trim() ?? "";
  if (key === "") {
    throw new ResendConfigError(
      "RESEND_API_KEY is required when EMAIL_PROVIDER=resend. See .env.example.",
    );
  }
  if (!API_KEY_PATTERN.test(key)) {
    throw new ResendConfigError(
      "RESEND_API_KEY must be re_ followed by 16 to 256 visible ASCII characters without spaces (the value is not shown).",
    );
  }
  return Object.freeze({ apiKey: key });
}

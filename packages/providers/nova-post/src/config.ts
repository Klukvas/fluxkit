/*
 * The plugin's own configuration (ADR 0029 decision 8: each plugin parses its own variables; ADR 0030 decision 2; plan
 * step 7b). Read once, when the provider module is created; a missing or malformed value stops the API's startup with a
 * message that names the variable and never its value. The base URL is one of two constants: no URL variable exists, so
 * nothing configurable can point the plugin at another host (no SSRF).
 */

export const NOVA_POST_ENVIRONMENTS = Object.freeze(["sandbox", "production"] as const);

export type NovaPostEnvironment = (typeof NOVA_POST_ENVIRONMENTS)[number];

/** ADR 0030 decision 3. The second Ukrainian endpoint (`api.novaposhta.ua/v.1.0`) is not used in v1. */
export const NOVA_POST_BASE_URLS: Readonly<Record<NovaPostEnvironment, string>> = Object.freeze({
  sandbox: "https://api-stage.novapost.com/v.1.0",
  production: "https://api.novapost.com/v.1.0",
});

export interface NovaPostConfig {
  readonly apiKey: string;
  readonly environment: NovaPostEnvironment;
  readonly baseUrl: string;
}

/**
 * The key's shape: 16 to 512 visible ASCII characters without spaces. Nova Post does not document the format, so the
 * check only refuses what cannot be a key (empty, a pasted line with spaces or quotes of another alphabet).
 */
const API_KEY_PATTERN = /^[\x21-\x7E]{16,512}$/;

export class NovaPostConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NovaPostConfigError";
  }
}

/**
 * `NOVA_POST_API_KEY` (required) and `NOVA_POST_ENVIRONMENT` (`sandbox` by default; `production` only when written).
 * Throws `NovaPostConfigError`; the message names the variable and the rule, never the value.
 */
export function parseNovaPostEnv(
  env: Readonly<Record<string, string | undefined>>,
): NovaPostConfig {
  const key = env.NOVA_POST_API_KEY?.trim() ?? "";
  if (key === "") {
    throw new NovaPostConfigError(
      "NOVA_POST_API_KEY is required when the nova_post shipping provider is enabled (SHIPPING_PROVIDERS_ENABLED). See .env.example.",
    );
  }
  if (!API_KEY_PATTERN.test(key)) {
    throw new NovaPostConfigError(
      "NOVA_POST_API_KEY must be 16 to 512 visible ASCII characters without spaces (the value is not shown).",
    );
  }
  const rawEnvironment = env.NOVA_POST_ENVIRONMENT?.trim() ?? "";
  const environment = rawEnvironment === "" ? "sandbox" : rawEnvironment;
  if (!(NOVA_POST_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new NovaPostConfigError(
      `NOVA_POST_ENVIRONMENT must be one of ${NOVA_POST_ENVIRONMENTS.join(", ")} (unset means sandbox).`,
    );
  }
  const chosen = environment as NovaPostEnvironment;
  return Object.freeze({ apiKey: key, environment: chosen, baseUrl: NOVA_POST_BASE_URLS[chosen] });
}

import type { SecretsKeyRing } from "@fluxkit/config";

export const INTEGRATIONS_CONFIG = Symbol("INTEGRATIONS_CONFIG");

export interface IntegrationsConfig {
  /** `SECRETS_ENCRYPTION_KEY` and its predecessor; `null` switches the store off (reads still work). */
  readonly keyRing: SecretsKeyRing | null;
  /** Where provider packages are installed (`<repo>/packages/providers`). */
  readonly providersDir: string;
  /** Test-only providers are not offered when true. */
  readonly isProduction: boolean;
  /** The process environment as read at start: only whether a declared variable is set is ever looked at. */
  readonly environment: Readonly<Record<string, string | undefined>>;
}

/** A caller without an environment (the OpenAPI export, the commands): nothing installed is offered, nothing is stored. */
export const DISABLED_INTEGRATIONS_CONFIG: IntegrationsConfig = Object.freeze({
  keyRing: null,
  providersDir: "",
  isProduction: false,
  environment: Object.freeze({}),
});

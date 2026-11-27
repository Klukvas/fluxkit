import type { SecretsKeyRing } from "@fluxkit/config";

export const INTEGRATIONS_CONFIG = Symbol("INTEGRATIONS_CONFIG");

export interface IntegrationsConfig {
  /** `SECRETS_ENCRYPTION_KEY` and its predecessor; `null` switches the store off (reads still work). */
  readonly keyRing: SecretsKeyRing | null;
  /** Where provider packages are installed (`<repo>/packages/providers`). */
  readonly providersDir: string;
  /** Test-only providers are not offered when true. */
  readonly isProduction: boolean;
  /** The process environment as read at start: only declared credential presence and declared environment values are inspected. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** True when `EMAIL_PROVIDER` is absent, so an activated stored credential may send. */
  readonly emailRouteDelegated: boolean;
  /** The effective `EMAIL_FROM` address. Email cannot be activated without one. */
  readonly emailFromAddress: string | null;
  readonly paymentDelegated: boolean;
  readonly shippingDelegated: boolean;
  readonly shopCurrency: string;
  readonly orderPaymentTtlMinutes: number;
  readonly storefrontPublicUrl: string | null;
}

/** A caller without an environment (the OpenAPI export, the commands): nothing installed is offered, nothing is stored. */
export const DISABLED_INTEGRATIONS_CONFIG: IntegrationsConfig = Object.freeze({
  keyRing: null,
  providersDir: "",
  isProduction: false,
  environment: Object.freeze({}),
  emailRouteDelegated: false,
  emailFromAddress: null,
  paymentDelegated: false,
  shippingDelegated: false,
  shopCurrency: "UAH",
  orderPaymentTtlMinutes: 30,
  storefrontPublicUrl: null,
});

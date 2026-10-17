import {
  DEFAULT_CUSTOMER_SESSION_IDLE_MINUTES,
  DEFAULT_CUSTOMER_SESSION_MAX_HOURS,
} from "@fluxkit/config";

export const CUSTOMER_AUTH_CONFIG = Symbol("CUSTOMER_AUTH_CONFIG");

/** From `STORE_COOKIE_SECURE`, `CUSTOMER_SESSION_IDLE_MINUTES` and `CUSTOMER_SESSION_MAX_HOURS` (docs/contracts/config.md). */
export interface CustomerAuthConfig {
  cookieSecure: boolean;
  idleMinutes: number;
  maxHours: number;
}

/** Secure by default: a caller that builds the app without an environment still gets the Secure flag. */
export const DEFAULT_CUSTOMER_AUTH_CONFIG: Readonly<CustomerAuthConfig> = Object.freeze({
  cookieSecure: true,
  idleMinutes: DEFAULT_CUSTOMER_SESSION_IDLE_MINUTES,
  maxHours: DEFAULT_CUSTOMER_SESSION_MAX_HOURS,
});

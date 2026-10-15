import {
  DEFAULT_ADMIN_SESSION_IDLE_MINUTES,
  DEFAULT_ADMIN_SESSION_MAX_HOURS,
} from "@fluxkit/config";

export const ADMIN_AUTH_CONFIG = Symbol("ADMIN_AUTH_CONFIG");

/** From `ADMIN_COOKIE_SECURE`, `ADMIN_SESSION_IDLE_MINUTES` and `ADMIN_SESSION_MAX_HOURS` (docs/contracts/config.md). */
export interface AdminAuthConfig {
  cookieSecure: boolean;
  idleMinutes: number;
  maxHours: number;
}

/** Secure by default: a caller that builds the app without an environment still gets the Secure flag. */
export const DEFAULT_ADMIN_AUTH_CONFIG: Readonly<AdminAuthConfig> = Object.freeze({
  cookieSecure: true,
  idleMinutes: DEFAULT_ADMIN_SESSION_IDLE_MINUTES,
  maxHours: DEFAULT_ADMIN_SESSION_MAX_HOURS,
});

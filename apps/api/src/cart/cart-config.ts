import { DEFAULT_CART_TTL_DAYS } from "@fluxkit/config";

export const CART_CONFIG = Symbol("CART_CONFIG");

/** From `CART_TTL_DAYS` (docs/contracts/config.md). The cookie's `Secure` flag is `STORE_COOKIE_SECURE` (customer auth config). */
export interface CartConfig {
  ttlDays: number;
}

export const DEFAULT_CART_CONFIG: Readonly<CartConfig> = Object.freeze({
  ttlDays: DEFAULT_CART_TTL_DAYS,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a cart last written at `now` expires. */
export function cartExpiry(now: Date, config: CartConfig): Date {
  return new Date(now.getTime() + config.ttlDays * DAY_MS);
}

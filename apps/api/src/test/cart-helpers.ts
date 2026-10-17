import { createHash } from "node:crypto";
import type pg from "pg";
import type { ProblemBody } from "../common/problem.filter.js";
import type { CartResponse } from "../cart/cart.schemas.js";

/** TEST ONLY. Shared by the cart specs. */

export type CartResult = CartResponse & ProblemBody;

export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

export interface CartRowForTest {
  id: string;
  token_hash: string | null;
  customer_id: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

export interface CartItemRowForTest {
  variant_id: string;
  quantity: number;
  seen_unit_amount: string | null;
  seen_currency: string | null;
}

export async function cartRowsOfToken(pool: pg.Pool, token: string): Promise<CartRowForTest[]> {
  const result = await pool.query<CartRowForTest>("select * from cart where token_hash = $1", [
    sha256Hex(token),
  ]);
  return result.rows;
}

export async function cartRowOfCustomer(
  pool: pg.Pool,
  customerId: string,
): Promise<CartRowForTest | undefined> {
  const result = await pool.query<CartRowForTest>("select * from cart where customer_id = $1", [
    customerId,
  ]);
  return result.rows[0];
}

export async function itemsOfCart(pool: pg.Pool, cartId: string): Promise<CartItemRowForTest[]> {
  const result = await pool.query<CartItemRowForTest>(
    `select variant_id, quantity, seen_unit_amount, seen_currency
       from cart_item where cart_id = $1 order by created_at, id`,
    [cartId],
  );
  return result.rows;
}

/**
 * Carts created at or after `since`. Every spec file runs its app on a fake clock in its own year, so this counts only the
 * carts of that file even while other files run in parallel.
 */
export async function countCartsSince(pool: pg.Pool, since: Date): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "select count(*)::int as count from cart where created_at >= $1",
    [since],
  );
  return (result.rows[0] as { count: number }).count;
}

/** Every key at every depth of a JSON value, for leak scans. */
export function deepKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) deepKeys(entry, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      into.add(key);
      deepKeys(entry, into);
    }
  }
  return into;
}

export const quantities = (cart: CartResponse): Record<string, number> =>
  Object.fromEntries(cart.lines.map((line) => [line.variantId, line.quantity]));

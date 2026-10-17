import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { createMoney, type CartLine, type Money } from "@fluxkit/core";
import type { DbExecutor, Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { cart, cartItem, customer } from "../database/schema/index.js";

export type CartRow = typeof cart.$inferSelect;

function toSeenColumns(seen: Money | null): {
  seenUnitAmount: number | null;
  seenCurrency: string | null;
} {
  return seen === null
    ? { seenUnitAmount: null, seenCurrency: null }
    : { seenUnitAmount: seen.amount, seenCurrency: seen.currency };
}

function toStoredLine(row: typeof cartItem.$inferSelect): CartLine {
  if (row.seenUnitAmount === null || row.seenCurrency === null) {
    return { variantId: row.variantId, quantity: row.quantity, seen: null };
  }
  const seen = createMoney(row.seenUnitAmount, row.seenCurrency);
  if (!seen.ok) {
    // The CHECK constraints keep amounts in range; a stored currency core does not know is corrupt data. Fail loudly.
    throw new RangeError(`Cart line ${row.id} has a seen price core rejects: ${seen.reason}`);
  }
  return { variantId: row.variantId, quantity: row.quantity, seen: seen.money };
}

/**
 * Queries on `cart` and `cart_item` (Drizzle, parameterized). Knows tables and locks, not rules: quantities, limits and
 * merging are core (`@fluxkit/core` cart), the cart lifecycle is `CartService`. Nothing here takes a cart id from a
 * request: carts are found by the hash of the cookie token or by the customer id of the session only.
 *
 * Lock order across the cart feature (ADR 0015): customer row (`FOR KEY SHARE` or `FOR UPDATE`) -> cart rows, lower id
 * first -> `cart_item` rows. Checkout (step 5) continues after the cart row.
 */
@Injectable()
export class CartRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByTokenHash(
    tokenHash: string,
    executor: DbExecutor = this.db,
  ): Promise<CartRow | undefined> {
    const [row] = await executor.select().from(cart).where(eq(cart.tokenHash, tokenHash));
    return row;
  }

  async findByCustomerId(
    customerId: string,
    executor: DbExecutor = this.db,
  ): Promise<CartRow | undefined> {
    const [row] = await executor.select().from(cart).where(eq(cart.customerId, customerId));
    return row;
  }

  /** The guest cart of a cookie, locked until the transaction ends. */
  async lockByTokenHash(tokenHash: string, transaction: Transaction): Promise<CartRow | undefined> {
    const [row] = await transaction
      .select()
      .from(cart)
      .where(eq(cart.tokenHash, tokenHash))
      .for("update");
    return row;
  }

  async lockById(cartId: string, transaction: Transaction): Promise<CartRow | undefined> {
    const [row] = await transaction.select().from(cart).where(eq(cart.id, cartId)).for("update");
    return row;
  }

  async insertGuest(
    tokenHash: string,
    now: Date,
    expiresAt: Date,
    transaction: Transaction,
  ): Promise<CartRow> {
    const [row] = await transaction
      .insert(cart)
      .values({ tokenHash, createdAt: now, updatedAt: now, expiresAt })
      .returning();
    if (row === undefined) {
      throw new Error("The guest cart insert returned no row");
    }
    return row;
  }

  /**
   * Takes `FOR KEY SHARE` on the customer row first, then creates the customer's cart when there is none
   * (`ON CONFLICT DO NOTHING` on the unique `customer_id`, so parallel first writes of one customer end with exactly one
   * row). The customer row lock keeps the order customer -> cart that the sign-in transaction (which holds the customer
   * row `FOR UPDATE`) also follows, so the two can never wait for each other. Does not lock the cart. Returns `false`
   * when the customer does not exist any more.
   */
  async ensureCustomerCart(
    customerId: string,
    now: Date,
    expiresAt: Date,
    transaction: Transaction,
  ): Promise<boolean> {
    const owner = await transaction
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, customerId))
      .for("key share");
    if (owner.length === 0) {
      return false;
    }
    await transaction
      .insert(cart)
      .values({ customerId, createdAt: now, updatedAt: now, expiresAt })
      .onConflictDoNothing({ target: cart.customerId });
    return true;
  }

  /**
   * Takes `FOR KEY SHARE` on the customer row WITHOUT creating a cart: the first lock of a customer's checkout, so it
   * follows the order customer row -> cart that carts writes and the sign-in merge already follow. (The order insert
   * takes this lock anyway for its foreign key; taking it before the cart lock keeps the sign-in merge, which holds the
   * customer row `FOR UPDATE`, from waiting for a cart that the checkout holds while the checkout waits for the
   * customer row.) Returns `false` when the customer does not exist any more.
   */
  async keyShareCustomer(customerId: string, transaction: Transaction): Promise<boolean> {
    const owner = await transaction
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, customerId))
      .for("key share");
    return owner.length > 0;
  }

  /** The customer's cart, locked until the transaction ends. */
  async lockByCustomerId(
    customerId: string,
    transaction: Transaction,
  ): Promise<CartRow | undefined> {
    const [row] = await transaction
      .select()
      .from(cart)
      .where(eq(cart.customerId, customerId))
      .for("update");
    return row;
  }

  /** Lines in the order they were added (insertion time, then id). */
  async listLines(cartId: string, executor: DbExecutor = this.db): Promise<CartLine[]> {
    const rows = await executor
      .select()
      .from(cartItem)
      .where(eq(cartItem.cartId, cartId))
      .orderBy(asc(cartItem.createdAt), asc(cartItem.id));
    return rows.map(toStoredLine);
  }

  /** Adds the line or replaces quantity and seen price of the existing one. A new line goes last (`clock_timestamp()`). */
  async upsertLine(
    cartId: string,
    line: CartLine,
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    const seen = toSeenColumns(line.seen);
    await transaction
      .insert(cartItem)
      .values({
        cartId,
        variantId: line.variantId,
        quantity: line.quantity,
        ...seen,
        createdAt: sql`clock_timestamp()`,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cartItem.cartId, cartItem.variantId],
        set: { quantity: line.quantity, ...seen, updatedAt: now },
      });
  }

  /** Several new lines in one statement, in the given order (a microsecond apart so the order is stable). */
  async insertLines(
    cartId: string,
    lines: readonly CartLine[],
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    if (lines.length === 0) {
      return;
    }
    await transaction.insert(cartItem).values(
      lines.map((line, index) => ({
        cartId,
        variantId: line.variantId,
        quantity: line.quantity,
        ...toSeenColumns(line.seen),
        createdAt: sql`clock_timestamp() + ${index} * interval '1 microsecond'`,
        updatedAt: now,
      })),
    );
  }

  /**
   * Sets quantity and seen price of existing lines in ONE statement, however many lines change (acknowledge and the
   * merge can touch up to 100). Lines that are not in the cart are ignored.
   */
  async updateLines(
    cartId: string,
    lines: readonly CartLine[],
    now: Date,
    transaction: Transaction,
  ): Promise<void> {
    if (lines.length === 0) {
      return;
    }
    const values = sql.join(
      lines.map(
        (line) =>
          sql`(${line.variantId}::uuid, ${line.quantity}::integer, ${line.seen?.amount ?? null}::bigint, ${line.seen?.currency ?? null}::text)`,
      ),
      sql`, `,
    );
    await transaction.execute(sql`
      update cart_item as item
         set quantity = changed.quantity,
             seen_unit_amount = changed.seen_unit_amount,
             seen_currency = changed.seen_currency,
             updated_at = ${now.toISOString()}::timestamptz
        from (values ${values}) as changed(variant_id, quantity, seen_unit_amount, seen_currency)
       where item.cart_id = ${cartId}::uuid and item.variant_id = changed.variant_id`);
  }

  async deleteLine(cartId: string, variantId: string, transaction: Transaction): Promise<void> {
    await transaction
      .delete(cartItem)
      .where(and(eq(cartItem.cartId, cartId), eq(cartItem.variantId, variantId)));
  }

  async deleteLines(cartId: string, transaction: Transaction): Promise<void> {
    await transaction.delete(cartItem).where(eq(cartItem.cartId, cartId));
  }

  /** Records a write: `updated_at` and the sliding expiry. */
  async touch(cartId: string, now: Date, expiresAt: Date, transaction: Transaction): Promise<void> {
    await transaction.update(cart).set({ updatedAt: now, expiresAt }).where(eq(cart.id, cartId));
  }

  /** Deletes the cart; its lines go with it (cascade). */
  async deleteCart(cartId: string, transaction: Transaction): Promise<void> {
    await transaction.delete(cart).where(eq(cart.id, cartId));
  }
}

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { variant } from "./catalog.js";
import { customer } from "./customers.js";

/**
 * Carts (docs/plans/2026-10-17-cart-and-orders.md, ADR 0015). A cart holds no stock. Exactly one owner: a guest cart is
 * found by the hash of its cookie token, a customer cart by `customer_id` (one per customer). A cart line references
 * `variant_id`, never `product_id` (ADR 0004). Same naming conventions as the other schema files.
 *
 * The limits mirror packages/core: MAX_AMOUNT (pricing/limits) and MAX_LINE_QUANTITY (cart/limits). The spec compares them.
 */

const MAX_AMOUNT = 1_000_000_000_000;
const MAX_LINE_QUANTITY = 999;
const CURRENCY_PATTERN = "^[A-Z]{3}$";
const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const cart = pgTable(
  "cart",
  {
    id: id(),
    // SHA-256 (hex) of the random cart token; the raw token exists only in the cookie. Null for a customer cart.
    tokenHash: text("token_hash"),
    customerId: uuid("customer_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("cart_token_hash_key").on(t.tokenHash),
    unique("cart_customer_id_key").on(t.customerId),
    foreignKey({
      name: "cart_customer_id_fkey",
      columns: [t.customerId],
      foreignColumns: [customer.id],
    }).onDelete("cascade"),
    check(
      "cart_token_hash_check",
      sql`${t.tokenHash} IS NULL OR ${t.tokenHash} ~ ${sql.raw(`'${SHA256_HEX_PATTERN}'`)}`,
    ),
    // Exactly one owner: the token (guest) or the customer.
    check("cart_owner_check", sql`(${t.tokenHash} IS NULL) <> (${t.customerId} IS NULL)`),
    check("cart_expires_at_check", sql`${t.expiresAt} > ${t.createdAt}`),
    index("cart_expires_at_idx").on(t.expiresAt),
  ],
);

export const cartItem = pgTable(
  "cart_item",
  {
    id: id(),
    cartId: uuid("cart_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    // The unit price the shopper last saw, for the "price changed" notice. Minor units; both set or both null.
    seenUnitAmount: bigint("seen_unit_amount", { mode: "number" }),
    seenCurrency: text("seen_currency"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "cart_item_cart_id_fkey",
      columns: [t.cartId],
      foreignColumns: [cart.id],
    }).onDelete("cascade"),
    // A deleted variant leaves the cart. Only variants without stock history can be deleted (ADR 0013).
    foreignKey({
      name: "cart_item_variant_id_fkey",
      columns: [t.variantId],
      foreignColumns: [variant.id],
    }).onDelete("cascade"),
    unique("cart_item_cart_id_variant_id_key").on(t.cartId, t.variantId),
    check(
      "cart_item_quantity_check",
      sql`${t.quantity} >= 1 AND ${t.quantity} <= ${sql.raw(`${MAX_LINE_QUANTITY}`)}`,
    ),
    check(
      "cart_item_seen_unit_amount_check",
      sql`${t.seenUnitAmount} IS NULL OR (${t.seenUnitAmount} >= 0 AND ${t.seenUnitAmount} <= ${sql.raw(`${MAX_AMOUNT}`)})`,
    ),
    check(
      "cart_item_seen_currency_check",
      sql`${t.seenCurrency} IS NULL OR ${t.seenCurrency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`,
    ),
    check(
      "cart_item_seen_price_check",
      sql`(${t.seenUnitAmount} IS NULL) = (${t.seenCurrency} IS NULL)`,
    ),
    index("cart_item_variant_id_idx").on(t.variantId),
  ],
);

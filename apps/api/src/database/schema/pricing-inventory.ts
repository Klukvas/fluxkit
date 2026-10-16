import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";
import { variant } from "./catalog.js";

/**
 * Price and inventory tables (docs/plans/2026-10-16-pricing-and-inventory.md, ADR 0011, ADR 0012). Same naming
 * conventions as the catalog (`catalog.ts`): explicit names of at most 63 characters, `_key` / `_idx` / `_check` /
 * `_fkey` / `_pkey` suffixes. The `stock_movement` append-only trigger and the `main` location row live in the
 * hand-written part of `0003_pricing_inventory.sql` (drizzle-kit does not model triggers or data).
 *
 * The limits mirror packages/core: MAX_AMOUNT (pricing/limits), MAX_ON_HAND (inventory/limits), MAX_QUANTITY.
 */

const MAX_AMOUNT = 1_000_000_000_000;
const MAX_ON_HAND = 1_000_000_000;
const MAX_QUANTITY = 1_000_000;
const CODE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const CURRENCY_PATTERN = "^[A-Z]{3}$";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const price = pgTable(
  "price",
  {
    id: id(),
    variantId: uuid("variant_id").notNull(),
    currency: text("currency").notNull(),
    // Minor units. bigint as number is exact: the CHECK keeps every value below 2^53.
    amount: bigint("amount", { mode: "number" }).notNull(),
    compareAtAmount: bigint("compare_at_amount", { mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "price_variant_id_fkey",
      columns: [t.variantId],
      foreignColumns: [variant.id],
    }).onDelete("cascade"),
    unique("price_variant_id_currency_key").on(t.variantId, t.currency),
    check("price_currency_check", sql`${t.currency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`),
    check(
      "price_amount_check",
      sql`${t.amount} >= 0 AND ${t.amount} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "price_compare_at_amount_check",
      sql`${t.compareAtAmount} IS NULL OR (${t.compareAtAmount} > ${t.amount} AND ${t.compareAtAmount} <= ${sql.raw(`${MAX_AMOUNT}`)})`,
    ),
  ],
);

export const location = pgTable(
  "location",
  {
    id: id(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("location_code_key").on(t.code),
    check("location_code_check", sql`${t.code} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`),
    check("location_name_check", sql`${t.name} <> ''`),
    // At most one default location.
    uniqueIndex("location_is_default_key")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
);

export const inventoryLevel = pgTable(
  "inventory_level",
  {
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    onHand: integer("on_hand").notNull(),
    // No CHECK against on_hand: backorder must be able to oversell. Stock operations enforce it under a row lock.
    reserved: integer("reserved").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "inventory_level_pkey", columns: [t.variantId, t.locationId] }),
    foreignKey({
      name: "inventory_level_variant_id_fkey",
      columns: [t.variantId],
      foreignColumns: [variant.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "inventory_level_location_id_fkey",
      columns: [t.locationId],
      foreignColumns: [location.id],
    }).onDelete("restrict"),
    check(
      "inventory_level_on_hand_check",
      sql`${t.onHand} >= 0 AND ${t.onHand} <= ${sql.raw(`${MAX_ON_HAND}`)}`,
    ),
    check("inventory_level_reserved_check", sql`${t.reserved} >= 0`),
    index("inventory_level_location_id_idx").on(t.locationId),
  ],
);

/** Append-only journal (trigger in the migration, ADR 0012). Rows go away only with their variant (cascade). */
export const stockMovement = pgTable(
  "stock_movement",
  {
    id: id(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    delta: integer("delta").notNull(),
    kind: text("kind").notNull(),
    onHandAfter: integer("on_hand_after").notNull(),
    reason: text("reason"),
    reference: text("reference"),
    actorId: uuid("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "stock_movement_variant_id_fkey",
      columns: [t.variantId],
      foreignColumns: [variant.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "stock_movement_location_id_fkey",
      columns: [t.locationId],
      foreignColumns: [location.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "stock_movement_actor_id_fkey",
      columns: [t.actorId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    check("stock_movement_delta_check", sql`${t.delta} <> 0`),
    check(
      "stock_movement_kind_check",
      sql`${t.kind} IN ('receipt', 'adjustment', 'sale', 'return')`,
    ),
    check(
      "stock_movement_on_hand_after_check",
      sql`${t.onHandAfter} >= 0 AND ${t.onHandAfter} <= ${sql.raw(`${MAX_ON_HAND}`)}`,
    ),
    // A variant's movements, newest first (the id breaks ties of equal timestamps).
    index("stock_movement_variant_id_created_at_idx").on(
      t.variantId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("stock_movement_location_id_idx").on(t.locationId),
    index("stock_movement_actor_id_idx").on(t.actorId),
  ],
);

export const reservation = pgTable(
  "reservation",
  {
    id: id(),
    variantId: uuid("variant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reference: text("reference"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "reservation_variant_id_fkey",
      columns: [t.variantId],
      foreignColumns: [variant.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "reservation_location_id_fkey",
      columns: [t.locationId],
      foreignColumns: [location.id],
    }).onDelete("restrict"),
    check(
      "reservation_quantity_check",
      sql`${t.quantity} > 0 AND ${t.quantity} <= ${sql.raw(`${MAX_QUANTITY}`)}`,
    ),
    check(
      "reservation_status_check",
      sql`${t.status} IN ('active', 'committed', 'released', 'expired')`,
    ),
    index("reservation_status_expires_at_idx").on(t.status, t.expiresAt),
    index("reservation_variant_id_idx").on(t.variantId),
    index("reservation_location_id_idx").on(t.locationId),
  ],
);

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";
import { salesOrder } from "./orders.js";

/**
 * Shipping (ADR 0029 decision 7, migration 0006). Same naming conventions as `catalog.ts` and `orders.ts`.
 *
 * Triggers live in the hand-written part of `0006_shipping.sql` (drizzle-kit does not model them): `order_shipping` is
 * immutable and `shipment_status_change` is append-only (the ADR 0019 technique).
 *
 * The lists and limits mirror packages/core, as in `orders.ts`: SHIPPING_METHOD_KINDS, SHIPPING_PAYERS,
 * SHIPPING_LIMITS, COUNTRY_CODE_PATTERN, CARRIER_CODE_PATTERN, CARRIER_REFERENCE_PATTERN, SHIPPING_PRICING_TYPES,
 * SHIPMENT_STATUSES, SHIPMENT_ACTORS, SHIPMENT_PAYERS, INACTIVE_SHIPMENT_STATUSES and the terminal statuses of
 * SHIPMENT_TRANSITIONS (shipping), MAX_AMOUNT (pricing), CODE_PATTERN and TEXT_LIMITS (catalog), ORDER_NUMBER_PATTERN
 * (orders). shipping-schema.spec.ts compares every one of them with core.
 */

const MAX_AMOUNT = 1_000_000_000_000;
const CODE_MAX_LENGTH = 64;
const MAX_COUNTRIES_PER_METHOD = 250;
const SEATS_PER_SHIPMENT = 1;
const CODE_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const CURRENCY_PATTERN = "^[A-Z]{3}$";
// COUNTRY_CODE_PATTERN (`^[A-Z]{2}$`) for every element of the comma-joined list.
const COUNTRY_LIST_PATTERN = "^[A-Z]{2}(,[A-Z]{2})*$";
const CARRIER_CODE_PATTERN = "^[A-Za-z0-9_.-]{1,32}$";
const CARRIER_REFERENCE_PATTERN = "^[A-Za-z0-9_-]{1,64}$";
const ORDER_NUMBER_PATTERN = "^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$";
const METHOD_KIND_LIST = "'address', 'pickup_point', 'store_pickup'";
const SHIPPING_PAYER_LIST = "'shop_charge', 'recipient_on_delivery'";
const PRICING_TYPE_LIST = "'flat', 'free_over', 'tiers', 'carrier_on_delivery'";
const SHIPMENT_STATUS_LIST =
  "'pending', 'unknown', 'created', 'in_transit', 'arrived', 'delivered', 'returning', 'returned', 'cancelled', 'failed'";
const INACTIVE_SHIPMENT_STATUS_LIST = "'cancelled', 'failed'";
const TERMINAL_SHIPMENT_STATUS_LIST = "'delivered', 'returned', 'cancelled', 'failed'";
const SHIPMENT_ACTOR_LIST = "'admin', 'system'";
const SHIPMENT_PAYER_LIST = "'sender', 'recipient'";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
// Minor units. bigint as number is exact: the CHECKs keep every value below 2^53.
const money = (name: string) => bigint(name, { mode: "number" });

/**
 * Delivery methods the admin manages (ADR 0029 decisions 3 and 7). `pricing` is validated by core
 * (`validateShippingPricing`) at write and again when a price is decided; the database checks its shape and type only.
 * `code` is never renamed. A method used by an order is deactivated, not deleted (a service rule, `method_in_use`).
 */
export const shippingMethod = pgTable(
  "shipping_method",
  {
    id: id(),
    code: text("code").notNull(),
    title: jsonb("title").notNull(),
    description: jsonb("description"),
    kind: text("kind").notNull(),
    // NULL for a method without a carrier plugin (a manual courier, store pickup).
    providerCode: text("provider_code"),
    // A provider service code (unverified for Nova Poshta), validated by the plugin.
    providerService: text("provider_service"),
    pricing: jsonb("pricing").notNull(),
    // The currency of every amount in `pricing`.
    currency: text("currency").notNull(),
    countryCodes: text("country_codes").array().notNull(),
    // A new method is inactive: activating one tightens the checkout (shipping_method_required).
    isActive: boolean("is_active").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("shipping_method_code_key").on(t.code),
    check("shipping_method_code_check", sql`${t.code} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`),
    check(
      "shipping_method_title_check",
      sql`jsonb_typeof(${t.title}) = 'object' AND ${t.title} <> '{}'::jsonb`,
    ),
    check(
      "shipping_method_description_check",
      sql`${t.description} IS NULL OR jsonb_typeof(${t.description}) = 'object'`,
    ),
    check("shipping_method_kind_check", sql`${t.kind} IN (${sql.raw(METHOD_KIND_LIST)})`),
    check(
      "shipping_method_provider_code_check",
      sql`${t.providerCode} IS NULL OR ${t.providerCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
    // A service belongs to a provider; a pickup point is resolved through a provider.
    check(
      "shipping_method_provider_service_check",
      sql`${t.providerService} IS NULL OR (${t.providerCode} IS NOT NULL AND char_length(${t.providerService}) BETWEEN 1 AND ${sql.raw(`${CODE_MAX_LENGTH}`)})`,
    ),
    check(
      "shipping_method_pickup_point_provider_check",
      sql`${t.kind} <> 'pickup_point' OR ${t.providerCode} IS NOT NULL`,
    ),
    check(
      "shipping_method_pricing_check",
      sql`jsonb_typeof(${t.pricing}) = 'object' AND (${t.pricing} ->> 'type') IS NOT NULL AND (${t.pricing} ->> 'type') IN (${sql.raw(PRICING_TYPE_LIST)})`,
    ),
    check(
      "shipping_method_currency_check",
      sql`${t.currency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`,
    ),
    // One dimension, 1 to the limit, no NULL element (array_to_string skips NULLs), every element two capital letters:
    // the joined text matches the list pattern AND is exactly 3 * n - 1 long, so no element can hide a comma ("UA,PL").
    check(
      "shipping_method_country_codes_check",
      sql`array_ndims(${t.countryCodes}) = 1 AND cardinality(${t.countryCodes}) BETWEEN 1 AND ${sql.raw(`${MAX_COUNTRIES_PER_METHOD}`)} AND array_position(${t.countryCodes}, NULL) IS NULL AND array_to_string(${t.countryCodes}, ',') ~ ${sql.raw(`'${COUNTRY_LIST_PATTERN}'`)} AND char_length(array_to_string(${t.countryCodes}, ',')) = 3 * cardinality(${t.countryCodes}) - 1`,
    ),
    check("shipping_method_position_check", sql`${t.position} >= 0`),
  ],
);

/**
 * Non-secret settings of one provider (sender data, default parcel), validated by the plugin. Secrets (API keys) live in
 * the environment only, never here (ADR 0029 decision 8).
 */
export const shippingProviderSetting = pgTable(
  "shipping_provider_setting",
  {
    providerCode: text("provider_code").primaryKey(),
    settings: jsonb("settings").notNull(),
    updatedAt: updatedAt(),
    // SET NULL when the admin user is deleted.
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    check(
      "shipping_provider_setting_provider_code_check",
      sql`${t.providerCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
    check("shipping_provider_setting_settings_check", sql`jsonb_typeof(${t.settings}) = 'object'`),
    foreignKey({
      name: "shipping_provider_setting_updated_by_fkey",
      columns: [t.updatedBy],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    index("shipping_provider_setting_updated_by_idx").on(t.updatedBy),
  ],
);

/**
 * The immutable shipping snapshot of an order, 1:1 (trigger in the migration, ADR 0019 style). `method_id` is a link that
 * becomes NULL when the method row is deleted; everything else never changes. `amount` equals the order's shipping
 * adjustment. `destination` holds the public carrier data of a pickup point, never personal data.
 */
export const orderShipping = pgTable(
  "order_shipping",
  {
    orderId: uuid("order_id").primaryKey(),
    methodId: uuid("method_id"),
    methodCode: text("method_code").notNull(),
    kind: text("kind").notNull(),
    providerCode: text("provider_code"),
    providerService: text("provider_service"),
    // Every locale of the method title at purchase time.
    title: jsonb("title").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    payer: text("payer").notNull(),
    // The carrier's informational estimate shown at checkout; never charged.
    estimatedCarrierAmount: money("estimated_carrier_amount"),
    destination: jsonb("destination"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "order_shipping_order_id_fkey",
      columns: [t.orderId],
      foreignColumns: [salesOrder.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_shipping_method_id_fkey",
      columns: [t.methodId],
      foreignColumns: [shippingMethod.id],
    }).onDelete("set null"),
    check(
      "order_shipping_method_code_check",
      sql`${t.methodCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
    check("order_shipping_kind_check", sql`${t.kind} IN (${sql.raw(METHOD_KIND_LIST)})`),
    check(
      "order_shipping_provider_code_check",
      sql`${t.providerCode} IS NULL OR ${t.providerCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`,
    ),
    check(
      "order_shipping_provider_service_check",
      sql`${t.providerService} IS NULL OR (${t.providerCode} IS NOT NULL AND char_length(${t.providerService}) BETWEEN 1 AND ${sql.raw(`${CODE_MAX_LENGTH}`)})`,
    ),
    check(
      "order_shipping_title_check",
      sql`jsonb_typeof(${t.title}) = 'object' AND ${t.title} <> '{}'::jsonb`,
    ),
    check(
      "order_shipping_amount_check",
      sql`${t.amount} >= 0 AND ${t.amount} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "order_shipping_currency_check",
      sql`${t.currency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`,
    ),
    check("order_shipping_payer_check", sql`${t.payer} IN (${sql.raw(SHIPPING_PAYER_LIST)})`),
    // The recipient pays the carrier: the shop charges nothing (pricing `carrier_on_delivery`).
    check(
      "order_shipping_payer_amount_check",
      sql`${t.payer} <> 'recipient_on_delivery' OR ${t.amount} = 0`,
    ),
    check(
      "order_shipping_estimated_carrier_amount_check",
      sql`${t.estimatedCarrierAmount} IS NULL OR (${t.estimatedCarrierAmount} >= 0 AND ${t.estimatedCarrierAmount} <= ${sql.raw(`${MAX_AMOUNT}`)})`,
    ),
    // A destination object exactly for a pickup point; an address order keeps sales_order.shipping_address. The IS NOT
    // NULL matters: jsonb_typeof(NULL) is NULL, and a CHECK that evaluates to NULL passes.
    check(
      "order_shipping_destination_check",
      sql`(${t.kind} = 'pickup_point' AND ${t.destination} IS NOT NULL AND jsonb_typeof(${t.destination}) = 'object') OR (${t.kind} <> 'pickup_point' AND ${t.destination} IS NULL)`,
    ),
    index("order_shipping_method_id_idx").on(t.methodId),
  ],
);

/**
 * One carrier waybill of an order (ADR 0029 decisions 7 and 10). Written as `pending` before the carrier call. At most one
 * active (not cancelled, not failed) shipment per order (owner answer 9). Holds no recipient name or phone and no carrier
 * text; `carrier_status_code` is the raw carrier code only. An order with a shipment is never deleted (RESTRICT).
 */
export const shipment = pgTable(
  "shipment",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    providerCode: text("provider_code").notNull(),
    providerService: text("provider_service"),
    status: text("status").notNull(),
    carrierStatusCode: text("carrier_status_code"),
    carrierStatusAt: timestamp("carrier_status_at", { withTimezone: true }),
    // The waybill number; NULL until the carrier answers.
    trackingNumber: text("tracking_number"),
    // The carrier's internal id of the waybill; NULL until the carrier answers.
    providerRef: text("provider_ref"),
    // Our order number sent to the carrier, to find the waybill after a lost answer (`reconcile`).
    clientReference: text("client_reference").notNull(),
    declaredValueAmount: money("declared_value_amount").notNull(),
    currency: text("currency").notNull(),
    // The carrier's own price of this waybill; informational, never charged.
    carrierCostAmount: money("carrier_cost_amount"),
    payer: text("payer").notNull(),
    weightGrams: integer("weight_grams").notNull(),
    lengthMm: integer("length_mm").notNull(),
    widthMm: integer("width_mm").notNull(),
    heightMm: integer("height_mm").notNull(),
    seats: integer("seats").notNull().default(SEATS_PER_SHIPMENT),
    // SET NULL when the admin user is deleted.
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    nextTrackAt: timestamp("next_track_at", { withTimezone: true }),
    trackingAttempts: integer("tracking_attempts").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "shipment_order_id_fkey",
      columns: [t.orderId],
      foreignColumns: [salesOrder.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "shipment_created_by_fkey",
      columns: [t.createdBy],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    unique("shipment_provider_code_tracking_number_key").on(t.providerCode, t.trackingNumber),
    check("shipment_provider_code_check", sql`${t.providerCode} ~ ${sql.raw(`'${CODE_PATTERN}'`)}`),
    check(
      "shipment_provider_service_check",
      sql`${t.providerService} IS NULL OR char_length(${t.providerService}) BETWEEN 1 AND ${sql.raw(`${CODE_MAX_LENGTH}`)}`,
    ),
    check("shipment_status_check", sql`${t.status} IN (${sql.raw(SHIPMENT_STATUS_LIST)})`),
    check(
      "shipment_carrier_status_code_check",
      sql`${t.carrierStatusCode} IS NULL OR ${t.carrierStatusCode} ~ ${sql.raw(`'${CARRIER_CODE_PATTERN}'`)}`,
    ),
    check(
      "shipment_tracking_number_check",
      sql`${t.trackingNumber} IS NULL OR ${t.trackingNumber} ~ ${sql.raw(`'${CARRIER_REFERENCE_PATTERN}'`)}`,
    ),
    check(
      "shipment_provider_ref_check",
      sql`${t.providerRef} IS NULL OR ${t.providerRef} ~ ${sql.raw(`'${CARRIER_REFERENCE_PATTERN}'`)}`,
    ),
    check(
      "shipment_client_reference_check",
      sql`${t.clientReference} ~ ${sql.raw(`'${ORDER_NUMBER_PATTERN}'`)}`,
    ),
    check(
      "shipment_declared_value_amount_check",
      sql`${t.declaredValueAmount} >= 0 AND ${t.declaredValueAmount} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check("shipment_currency_check", sql`${t.currency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`),
    check(
      "shipment_carrier_cost_amount_check",
      sql`${t.carrierCostAmount} IS NULL OR (${t.carrierCostAmount} >= 0 AND ${t.carrierCostAmount} <= ${sql.raw(`${MAX_AMOUNT}`)})`,
    ),
    check("shipment_payer_check", sql`${t.payer} IN (${sql.raw(SHIPMENT_PAYER_LIST)})`),
    check("shipment_weight_grams_check", sql`${t.weightGrams} > 0`),
    check("shipment_length_mm_check", sql`${t.lengthMm} > 0`),
    check("shipment_width_mm_check", sql`${t.widthMm} > 0`),
    check("shipment_height_mm_check", sql`${t.heightMm} > 0`),
    check(
      "shipment_seats_check",
      sql`${t.seats} BETWEEN 1 AND ${sql.raw(`${SEATS_PER_SHIPMENT}`)}`,
    ),
    check("shipment_tracking_attempts_check", sql`${t.trackingAttempts} >= 0`),
    index("shipment_order_id_idx").on(t.orderId),
    // One active shipment per order (owner answer 9); cancel and create again is allowed.
    uniqueIndex("shipment_order_id_active_key")
      .on(t.orderId)
      .where(sql`${t.status} NOT IN (${sql.raw(INACTIVE_SHIPMENT_STATUS_LIST)})`),
    // The tracking job: due shipments whose status is not terminal.
    index("shipment_next_track_at_idx")
      .on(t.nextTrackAt)
      .where(sql`${t.status} NOT IN (${sql.raw(TERMINAL_SHIPMENT_STATUS_LIST)})`),
    index("shipment_created_by_idx").on(t.createdBy),
  ],
);

/** Append-only status journal of a shipment (trigger in the migration). Rows go away only with their shipment (cascade). */
export const shipmentStatusChange = pgTable(
  "shipment_status_change",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull(),
    // Null for the creation of the shipment.
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    // The raw carrier code that caused the change; NULL for an admin action without a carrier answer.
    carrierStatusCode: text("carrier_status_code"),
    actorType: text("actor_type").notNull(),
    // SET NULL when the admin user is deleted (same depth-guarded exception as order_status_change.actor_admin_id).
    actorAdminId: uuid("actor_admin_id"),
    // clock_timestamp(), not now(): several changes in one transaction keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "shipment_status_change_shipment_id_fkey",
      columns: [t.shipmentId],
      foreignColumns: [shipment.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "shipment_status_change_actor_admin_id_fkey",
      columns: [t.actorAdminId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    check(
      "shipment_status_change_from_status_check",
      sql`${t.fromStatus} IS NULL OR ${t.fromStatus} IN (${sql.raw(SHIPMENT_STATUS_LIST)})`,
    ),
    check(
      "shipment_status_change_to_status_check",
      sql`${t.toStatus} IN (${sql.raw(SHIPMENT_STATUS_LIST)})`,
    ),
    check(
      "shipment_status_change_carrier_status_code_check",
      sql`${t.carrierStatusCode} IS NULL OR ${t.carrierStatusCode} ~ ${sql.raw(`'${CARRIER_CODE_PATTERN}'`)}`,
    ),
    check(
      "shipment_status_change_actor_type_check",
      sql`${t.actorType} IN (${sql.raw(SHIPMENT_ACTOR_LIST)})`,
    ),
    index("shipment_status_change_shipment_id_created_at_idx").on(t.shipmentId, t.createdAt),
    index("shipment_status_change_actor_admin_id_idx").on(t.actorAdminId),
  ],
);

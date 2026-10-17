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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUser } from "./admin-auth.js";
import { product, variant } from "./catalog.js";
import { customer } from "./customers.js";
import { reservation } from "./pricing-inventory.js";

/**
 * Orders (docs/plans/2026-10-17-cart-and-orders.md, ADR 0017, ADR 0019). `order` is an SQL keyword, so the table is
 * `sales_order`; its children keep the `order_` prefix. Same naming conventions as the other schema files.
 *
 * Triggers live in the hand-written part of `0004_cart_customers_orders.sql` (drizzle-kit does not model them):
 * `order_item` is immutable, `order_adjustment` and `order_status_change` are append-only (ADR 0019).
 *
 * The limits mirror packages/core: MAX_AMOUNT (pricing/limits), MAX_LINE_QUANTITY (cart/limits), CONTACT_LIMITS and
 * EMAIL_MAX_LENGTH, ORDER_NUMBER_PATTERN, ORDER_STATUSES and ORDER_ACTORS (orders), TEXT_LIMITS (catalog). The spec compares them.
 */

const MAX_AMOUNT = 1_000_000_000_000;
const MAX_LINE_QUANTITY = 999;
const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 100;
const SKU_MAX_LENGTH = 64;
const CODE_MAX_LENGTH = 64;
const URL_MAX_LENGTH = 2048;
const CANCELLATION_REASON_MAX_LENGTH = 500;
const PAYMENT_REFERENCE_MAX_LENGTH = 255;
const STATUS_CHANGE_REASON_MAX_LENGTH = 500;
const CURRENCY_PATTERN = "^[A-Z]{3}$";
const KIND_PATTERN = "^[a-z][a-z0-9_]{0,63}$";
const LOCALE_PATTERN = "^[a-z]{2,8}(-[a-z]{2,8})*$";
const PHONE_PATTERN = "^\\+?[0-9]{7,15}$";
const SHA256_HEX_PATTERN = "^[0-9a-f]{64}$";
// ORDER_NUMBER_PATTERN of packages/core: 8 Crockford base32 symbols, `XXXX-XXXX`.
const ORDER_NUMBER_PATTERN = "^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$";
const ORDER_STATUS_LIST = "'awaiting_payment', 'paid', 'fulfilled', 'cancelled', 'expired'";
const ORDER_ACTOR_LIST = "'customer', 'guest', 'admin', 'system'";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
// Minor units. bigint as number is exact: the CHECKs keep every value below 2^53.
const money = (name: string) => bigint(name, { mode: "number" });

export const salesOrder = pgTable(
  "sales_order",
  {
    id: id(),
    number: text("number").notNull(),
    status: text("status").notNull(),
    // SET NULL when the customer is deleted: the order keeps the contact data below (ADR 0019).
    customerId: uuid("customer_id"),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    shippingAddress: jsonb("shipping_address"),
    billingAddress: jsonb("billing_address"),
    locale: text("locale").notNull(),
    currency: text("currency").notNull(),
    subtotalAmount: money("subtotal_amount").notNull(),
    shippingTotal: money("shipping_total").notNull(),
    discountTotal: money("discount_total").notNull(),
    taxTotal: money("tax_total").notNull(),
    totalAmount: money("total_amount").notNull(),
    // SHA-256 (hex) of the guest access token. Guest orders only: a customer order has none (CHECK), and keeps none
    // when its customer is deleted.
    accessTokenHash: text("access_token_hash"),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    // SHA-256 (hex) of the normalized checkout request plus the cart id; never leaves the API.
    requestFingerprint: text("request_fingerprint").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    paymentReference: text("payment_reference"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "sales_order_customer_id_fkey",
      columns: [t.customerId],
      foreignColumns: [customer.id],
    }).onDelete("set null"),
    unique("sales_order_number_key").on(t.number),
    unique("sales_order_access_token_hash_key").on(t.accessTokenHash),
    unique("sales_order_idempotency_key_key").on(t.idempotencyKey),
    check("sales_order_number_check", sql`${t.number} ~ ${sql.raw(`'${ORDER_NUMBER_PATTERN}'`)}`),
    check("sales_order_status_check", sql`${t.status} IN (${sql.raw(ORDER_STATUS_LIST)})`),
    check(
      "sales_order_email_check",
      sql`${t.email} = lower(btrim(${t.email})) AND char_length(${t.email}) BETWEEN 3 AND ${sql.raw(`${EMAIL_MAX_LENGTH}`)}`,
    ),
    check("sales_order_phone_check", sql`${t.phone} ~ ${sql.raw(`'${PHONE_PATTERN}'`)}`),
    check(
      "sales_order_first_name_check",
      sql`char_length(${t.firstName}) BETWEEN 1 AND ${sql.raw(`${NAME_MAX_LENGTH}`)}`,
    ),
    check(
      "sales_order_last_name_check",
      sql`char_length(${t.lastName}) BETWEEN 1 AND ${sql.raw(`${NAME_MAX_LENGTH}`)}`,
    ),
    check(
      "sales_order_shipping_address_check",
      sql`${t.shippingAddress} IS NULL OR jsonb_typeof(${t.shippingAddress}) = 'object'`,
    ),
    check(
      "sales_order_billing_address_check",
      sql`${t.billingAddress} IS NULL OR jsonb_typeof(${t.billingAddress}) = 'object'`,
    ),
    check("sales_order_locale_check", sql`${t.locale} ~ ${sql.raw(`'${LOCALE_PATTERN}'`)}`),
    check("sales_order_currency_check", sql`${t.currency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`),
    check(
      "sales_order_subtotal_amount_check",
      sql`${t.subtotalAmount} >= 0 AND ${t.subtotalAmount} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "sales_order_shipping_total_check",
      sql`${t.shippingTotal} >= 0 AND ${t.shippingTotal} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    // Discounts are negative adjustments (or zero); the sum is within the maximum.
    check(
      "sales_order_discount_total_check",
      sql`${t.discountTotal} <= 0 AND ${t.discountTotal} >= -${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "sales_order_tax_total_check",
      sql`${t.taxTotal} >= 0 AND ${t.taxTotal} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "sales_order_total_amount_check",
      sql`${t.totalAmount} >= 0 AND ${t.totalAmount} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "sales_order_access_token_hash_check",
      sql`${t.accessTokenHash} IS NULL OR ${t.accessTokenHash} ~ ${sql.raw(`'${SHA256_HEX_PATTERN}'`)}`,
    ),
    // The token and its expiry exist together or not at all.
    check(
      "sales_order_access_pair_check",
      sql`(${t.accessTokenHash} IS NULL) = (${t.accessExpiresAt} IS NULL)`,
    ),
    // Guest access only: an order of a customer has no token (customer_id becoming NULL later keeps it token-less).
    check(
      "sales_order_customer_or_token_check",
      sql`${t.customerId} IS NULL OR ${t.accessTokenHash} IS NULL`,
    ),
    check(
      "sales_order_request_fingerprint_check",
      sql`${t.requestFingerprint} ~ ${sql.raw(`'${SHA256_HEX_PATTERN}'`)}`,
    ),
    check("sales_order_expires_at_check", sql`${t.expiresAt} > ${t.placedAt}`),
    check(
      "sales_order_cancellation_reason_check",
      sql`${t.cancellationReason} IS NULL OR char_length(${t.cancellationReason}) BETWEEN 1 AND ${sql.raw(`${CANCELLATION_REASON_MAX_LENGTH}`)}`,
    ),
    check(
      "sales_order_payment_reference_check",
      sql`${t.paymentReference} IS NULL OR char_length(${t.paymentReference}) BETWEEN 1 AND ${sql.raw(`${PAYMENT_REFERENCE_MAX_LENGTH}`)}`,
    ),
    index("sales_order_customer_id_placed_at_idx").on(t.customerId, t.placedAt.desc()),
    // The expiry job: awaiting_payment orders whose expires_at has passed.
    index("sales_order_status_expires_at_idx").on(t.status, t.expiresAt),
    // The admin list, newest first.
    index("sales_order_placed_at_idx").on(t.placedAt.desc()),
    // The admin search by exact email.
    index("sales_order_email_idx").on(t.email),
  ],
);

/**
 * The immutable snapshot of one purchased line (trigger in the migration, ADR 0019). `product_id` and `variant_id` are
 * links that become NULL when the catalog row is deleted; everything else never changes.
 */
export const orderItem = pgTable(
  "order_item",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    position: integer("position").notNull(),
    productId: uuid("product_id"),
    variantId: uuid("variant_id"),
    sku: text("sku").notNull(),
    productTitle: jsonb("product_title").notNull(),
    variantTitle: jsonb("variant_title"),
    optionValues: jsonb("option_values").notNull(),
    imageUrl: text("image_url"),
    unitAmount: money("unit_amount").notNull(),
    compareAtAmount: money("compare_at_amount"),
    quantity: integer("quantity").notNull(),
    lineTotal: money("line_total").notNull(),
    currency: text("currency").notNull(),
    requiresShipping: boolean("requires_shipping").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "order_item_order_id_fkey",
      columns: [t.orderId],
      foreignColumns: [salesOrder.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_item_product_id_fkey",
      columns: [t.productId],
      foreignColumns: [product.id],
    }).onDelete("set null"),
    foreignKey({
      name: "order_item_variant_id_fkey",
      columns: [t.variantId],
      foreignColumns: [variant.id],
    }).onDelete("set null"),
    unique("order_item_order_id_position_key").on(t.orderId, t.position),
    check("order_item_position_check", sql`${t.position} >= 0`),
    check(
      "order_item_sku_check",
      sql`char_length(${t.sku}) BETWEEN 1 AND ${sql.raw(`${SKU_MAX_LENGTH}`)}`,
    ),
    check("order_item_product_title_check", sql`jsonb_typeof(${t.productTitle}) = 'object'`),
    check(
      "order_item_variant_title_check",
      sql`${t.variantTitle} IS NULL OR jsonb_typeof(${t.variantTitle}) = 'object'`,
    ),
    check("order_item_option_values_check", sql`jsonb_typeof(${t.optionValues}) = 'array'`),
    check(
      "order_item_image_url_check",
      sql`${t.imageUrl} IS NULL OR char_length(${t.imageUrl}) BETWEEN 1 AND ${sql.raw(`${URL_MAX_LENGTH}`)}`,
    ),
    check(
      "order_item_unit_amount_check",
      sql`${t.unitAmount} >= 0 AND ${t.unitAmount} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "order_item_compare_at_amount_check",
      sql`${t.compareAtAmount} IS NULL OR (${t.compareAtAmount} > ${t.unitAmount} AND ${t.compareAtAmount} <= ${sql.raw(`${MAX_AMOUNT}`)})`,
    ),
    check(
      "order_item_quantity_check",
      sql`${t.quantity} >= 1 AND ${t.quantity} <= ${sql.raw(`${MAX_LINE_QUANTITY}`)}`,
    ),
    check(
      "order_item_line_total_check",
      sql`${t.lineTotal} >= 0 AND ${t.lineTotal} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check("order_item_line_total_sum_check", sql`${t.lineTotal} = ${t.unitAmount} * ${t.quantity}`),
    check("order_item_currency_check", sql`${t.currency} ~ ${sql.raw(`'${CURRENCY_PATTERN}'`)}`),
    index("order_item_product_id_idx").on(t.productId),
    index("order_item_variant_id_idx").on(t.variantId),
  ],
);

/** Shipping, discount, tax and plugin lines. Append-only (trigger in the migration). Empty in v1. */
export const orderAdjustment = pgTable(
  "order_adjustment",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    // Core knows shipping, discount and tax; plugins may add kinds without a migration.
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    label: jsonb("label").notNull(),
    // Signed: discounts are negative.
    amount: money("amount").notNull(),
    includedInPrice: boolean("included_in_price").notNull(),
    // The plugin that created the line; null for core.
    source: text("source"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "order_adjustment_order_id_fkey",
      columns: [t.orderId],
      foreignColumns: [salesOrder.id],
    }).onDelete("cascade"),
    check("order_adjustment_kind_check", sql`${t.kind} ~ ${sql.raw(`'${KIND_PATTERN}'`)}`),
    check(
      "order_adjustment_code_check",
      sql`char_length(${t.code}) BETWEEN 1 AND ${sql.raw(`${CODE_MAX_LENGTH}`)}`,
    ),
    check("order_adjustment_label_check", sql`jsonb_typeof(${t.label}) = 'object'`),
    check(
      "order_adjustment_amount_check",
      sql`${t.amount} >= -${sql.raw(`${MAX_AMOUNT}`)} AND ${t.amount} <= ${sql.raw(`${MAX_AMOUNT}`)}`,
    ),
    check(
      "order_adjustment_source_check",
      sql`${t.source} IS NULL OR char_length(${t.source}) BETWEEN 1 AND ${sql.raw(`${CODE_MAX_LENGTH}`)}`,
    ),
    index("order_adjustment_order_id_idx").on(t.orderId),
  ],
);

/** Append-only status journal (trigger in the migration). Rows go away only with their order (cascade). */
export const orderStatusChange = pgTable(
  "order_status_change",
  {
    id: id(),
    orderId: uuid("order_id").notNull(),
    // Null for the creation of the order.
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorType: text("actor_type").notNull(),
    // SET NULL when the admin user is deleted (same depth-guarded exception as stock_movement.actor_id).
    actorAdminId: uuid("actor_admin_id"),
    reason: text("reason"),
    // clock_timestamp(), not now(): several changes in one transaction keep their order.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    foreignKey({
      name: "order_status_change_order_id_fkey",
      columns: [t.orderId],
      foreignColumns: [salesOrder.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_status_change_actor_admin_id_fkey",
      columns: [t.actorAdminId],
      foreignColumns: [adminUser.id],
    }).onDelete("set null"),
    check(
      "order_status_change_from_status_check",
      sql`${t.fromStatus} IS NULL OR ${t.fromStatus} IN (${sql.raw(ORDER_STATUS_LIST)})`,
    ),
    check(
      "order_status_change_to_status_check",
      sql`${t.toStatus} IN (${sql.raw(ORDER_STATUS_LIST)})`,
    ),
    check(
      "order_status_change_actor_type_check",
      sql`${t.actorType} IN (${sql.raw(ORDER_ACTOR_LIST)})`,
    ),
    check(
      "order_status_change_reason_check",
      sql`${t.reason} IS NULL OR char_length(${t.reason}) BETWEEN 1 AND ${sql.raw(`${STATUS_CHANGE_REASON_MAX_LENGTH}`)}`,
    ),
    index("order_status_change_order_id_created_at_idx").on(t.orderId, t.createdAt),
    index("order_status_change_actor_admin_id_idx").on(t.actorAdminId),
  ],
);

/**
 * Which stock reservations hold the units of an order line. A reservation belongs to at most one line (unique
 * `reservation_id`); a line may have several reservations later (multi-location). `reservation_id` is RESTRICT: a
 * reservation that an order points at is never deleted, so deleting its variant fails (ADR 0019).
 */
export const orderItemReservation = pgTable(
  "order_item_reservation",
  {
    orderItemId: uuid("order_item_id").notNull(),
    reservationId: uuid("reservation_id").notNull(),
  },
  (t) => [
    primaryKey({
      name: "order_item_reservation_pkey",
      columns: [t.orderItemId, t.reservationId],
    }),
    foreignKey({
      name: "order_item_reservation_order_item_id_fkey",
      columns: [t.orderItemId],
      foreignColumns: [orderItem.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_item_reservation_reservation_id_fkey",
      columns: [t.reservationId],
      foreignColumns: [reservation.id],
    }).onDelete("restrict"),
    unique("order_item_reservation_reservation_id_key").on(t.reservationId),
  ],
);

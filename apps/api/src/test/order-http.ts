import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ProblemBody } from "../common/problem.filter.js";
import type { CheckoutResponse, StoreOrder } from "../orders/orders.schemas.js";
import type { HttpResult } from "./http.js";
import type { Shopper } from "./shopper.js";

/** TEST ONLY. Shared by the checkout and order specs. */

export type CheckoutResult = Partial<CheckoutResponse> & ProblemBody;
export type OrderResult = StoreOrder & Pick<ProblemBody, "code" | "detail" | "errors">;

export const ADDRESS = {
  countryCode: "UA",
  city: "Київ",
  line1: "вул. Хрещатик 1",
  postalCode: "01001",
};

export interface CheckoutBodyOptions {
  expectedTotal?: { amount: number; currency: string };
  [key: string]: unknown;
}

/** A valid checkout body for a physical order; every field can be replaced (or removed with `undefined`). */
export function checkoutBody(
  expectedAmount: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    email: "buyer@example.test",
    phone: "+380501234567",
    firstName: "Іван",
    lastName: "Петренко",
    shippingAddress: ADDRESS,
    expectedTotal: { amount: expectedAmount, currency: "UAH" },
    ...overrides,
  };
}

export function checkoutAs(
  shopper: Shopper,
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
  extra: { query?: string } = {},
): Promise<HttpResult<CheckoutResult>> {
  return shopper.request<CheckoutResult>("POST", `/store/checkout${extra.query ?? ""}`, {
    body,
    headers: key === null ? {} : { "idempotency-key": key },
  });
}

export interface OrderRowForTest {
  id: string;
  number: string;
  status: string;
  customer_id: string | null;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  shipping_address: Record<string, string> | null;
  billing_address: Record<string, string> | null;
  locale: string;
  currency: string;
  subtotal_amount: string;
  shipping_total: string;
  discount_total: string;
  tax_total: string;
  total_amount: string;
  access_token_hash: string | null;
  access_expires_at: Date | null;
  idempotency_key: string;
  request_fingerprint: string;
  placed_at: Date;
  expires_at: Date;
  paid_at: Date | null;
  fulfilled_at: Date | null;
  cancelled_at: Date | null;
  expired_at: Date | null;
  cancellation_reason: string | null;
  payment_reference: string | null;
}

export async function orderRow(pool: pg.Pool, number: string): Promise<OrderRowForTest> {
  const result = await pool.query<OrderRowForTest>("select * from sales_order where number = $1", [
    number,
  ]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Test setup bug: no order ${number}`);
  }
  return row;
}

export async function orderRowOrUndefined(
  pool: pg.Pool,
  number: string,
): Promise<OrderRowForTest | undefined> {
  const result = await pool.query<OrderRowForTest>("select * from sales_order where number = $1", [
    number,
  ]);
  return result.rows[0];
}

export interface OrderItemRowForTest {
  id: string;
  position: number;
  product_id: string | null;
  variant_id: string | null;
  sku: string;
  product_title: Record<string, string>;
  variant_title: Record<string, string> | null;
  option_values: { option: Record<string, string>; value: Record<string, string> }[];
  image_url: string | null;
  unit_amount: string;
  compare_at_amount: string | null;
  quantity: number;
  line_total: string;
  currency: string;
  requires_shipping: boolean;
}

export async function itemsOf(pool: pg.Pool, orderId: string): Promise<OrderItemRowForTest[]> {
  const result = await pool.query<OrderItemRowForTest>(
    "select * from order_item where order_id = $1 order by position",
    [orderId],
  );
  return result.rows;
}

export interface StatusChangeRowForTest {
  from_status: string | null;
  to_status: string;
  actor_type: string;
  actor_admin_id: string | null;
  reason: string | null;
}

export async function changesOf(pool: pg.Pool, orderId: string): Promise<StatusChangeRowForTest[]> {
  const result = await pool.query<StatusChangeRowForTest>(
    `select from_status, to_status, actor_type, actor_admin_id, reason
       from order_status_change where order_id = $1 order by created_at, id`,
    [orderId],
  );
  return result.rows;
}

export interface EventRowForTest {
  type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  dispatched_at: Date | null;
}

export async function eventsOf(pool: pg.Pool, orderId: string): Promise<EventRowForTest[]> {
  const result = await pool.query<EventRowForTest>(
    "select type, aggregate_id, payload, dispatched_at from domain_event where aggregate_id = $1 order by created_at, id",
    [orderId],
  );
  return result.rows;
}

export interface OrderReservationForTest {
  id: string;
  variant_id: string;
  location_id: string;
  quantity: number;
  status: string;
  reference: string | null;
  expires_at: Date;
  order_item_id: string;
}

export async function reservationsOfOrder(
  pool: pg.Pool,
  orderId: string,
): Promise<OrderReservationForTest[]> {
  const result = await pool.query<OrderReservationForTest>(
    `select r.id, r.variant_id, r.location_id, r.quantity, r.status, r.reference, r.expires_at, l.order_item_id
       from order_item_reservation l
       join order_item i on i.id = l.order_item_id
       join reservation r on r.id = l.reservation_id
      where i.order_id = $1
      order by i.position, r.id`,
    [orderId],
  );
  return result.rows;
}

/** Counts of the tables a checkout writes, so a refused checkout can be proven to leave nothing behind. */
export async function orderTableCounts(
  pool: pg.Pool,
  variantIds: readonly string[],
): Promise<{
  orders: number;
  items: number;
  links: number;
  changes: number;
  events: number;
  reservations: number;
  levels: { variant_id: string; on_hand: number; reserved: number }[];
}> {
  const result = await pool.query(
    `select (select count(*)::int from sales_order) as orders,
            (select count(*)::int from order_item) as items,
            (select count(*)::int from order_item_reservation) as links,
            (select count(*)::int from order_status_change) as changes,
            (select count(*)::int from domain_event) as events,
            (select count(*)::int from reservation where variant_id = any($1::uuid[])) as reservations`,
    [variantIds],
  );
  const levels = await pool.query(
    `select variant_id, on_hand, reserved from inventory_level
      where variant_id = any($1::uuid[]) order by variant_id`,
    [variantIds],
  );
  return { ...(result.rows[0] as object), levels: levels.rows } as never;
}

import { randomBytes, randomUUID } from "node:crypto";
import { formatOrderNumber } from "@fluxkit/core";
import type pg from "pg";

/** TEST ONLY. Shared by the order specs. */

/**
 * Writes a minimal `sales_order` with one `order_item` for a variant straight into the tables (no checkout), so a
 * catalog spec can prove that a sold variant is not deletable. The order is `paid` and the line is digital (no
 * reservation), which is exactly the case the stock-history rule does not see (ADR 0020).
 */
export async function insertSoldLine(
  pool: pg.Pool,
  target: { productId: string; variantId: string },
): Promise<{ orderId: string; itemId: string }> {
  const order = await pool.query<{ id: string }>(
    `insert into sales_order (number, status, email, phone, first_name, last_name, locale, currency,
                              subtotal_amount, shipping_total, discount_total, tax_total, total_amount,
                              idempotency_key, request_fingerprint, placed_at, expires_at, paid_at)
     values ($1, 'paid', 'sold-line@example.test', '380501234567', 'Test', 'Buyer', 'uk', 'UAH',
             1000, 0, 0, 0, 1000, $2, $3, now() - interval '1 hour', now() + interval '1 hour', now())
     returning id`,
    [formatOrderNumber(randomBytes(5)), randomUUID(), randomBytes(32).toString("hex")],
  );
  const orderId = order.rows[0]?.id;
  if (orderId === undefined) {
    throw new Error("Test setup bug: the order was not inserted");
  }
  const item = await pool.query<{ id: string }>(
    `insert into order_item (order_id, position, product_id, variant_id, sku, product_title, option_values,
                             unit_amount, quantity, line_total, currency, requires_shipping)
     values ($1, 0, $2, $3, $4, '{"uk":"Товар"}'::jsonb, '[]'::jsonb, 1000, 1, 1000, 'UAH', false)
     returning id`,
    [orderId, target.productId, target.variantId, `SOLD-${randomUUID().slice(0, 8).toUpperCase()}`],
  );
  const itemId = item.rows[0]?.id;
  if (itemId === undefined) {
    throw new Error("Test setup bug: the order item was not inserted");
  }
  return { orderId, itemId };
}

/**
 * Deletes the payment attempts of orders, their refunds and their outbox rows (test cleanup): a payment RESTRICTs its
 * order and a refund its payment; the journal goes with the payment by cascade.
 */
export async function deletePaymentsOfOrders(
  pool: pg.Pool,
  orderIds: readonly string[],
): Promise<void> {
  const refunds = await pool.query<{ id: string }>(
    "delete from payment_refund where payment_id in (select id from payment where order_id = any($1::uuid[])) returning id",
    [orderIds],
  );
  const payments = await pool.query<{ id: string }>(
    "delete from payment where order_id = any($1::uuid[]) returning id",
    [orderIds],
  );
  await pool.query("delete from domain_event where aggregate_id = any($1::uuid[])", [
    [...refunds.rows, ...payments.rows].map((row) => row.id),
  ]);
}

/** Deletes orders and everything below them (test cleanup; the application never deletes orders). */
export async function deleteOrders(pool: pg.Pool, orderIds: readonly string[]): Promise<void> {
  await deletePaymentsOfOrders(pool, orderIds);
  await pool.query("delete from sales_order where id = any($1::uuid[])", [orderIds]);
}

/**
 * TEST ONLY. Remembers the orders a spec placed and removes them (and their outbox rows) at the end, before the catalog
 * is cleaned: the reservations of an order are RESTRICTed by its lines, so the order has to go first.
 */
export class PlacedOrders {
  private readonly numbers = new Set<string>();

  constructor(private readonly pool: pg.Pool) {}

  track(number: string): string {
    this.numbers.add(number);
    return number;
  }

  async cleanup(): Promise<void> {
    const numbers = [...this.numbers];
    const orders = await this.pool.query<{ id: string }>(
      "select id from sales_order where number = any($1::text[])",
      [numbers],
    );
    const ids = orders.rows.map((row) => row.id);
    await this.pool.query("delete from domain_event where aggregate_id = any($1::uuid[])", [ids]);
    // A shipment RESTRICTs its order (and its journal goes with it by cascade); its events are keyed by the shipment id.
    const shipments = await this.pool.query<{ id: string }>(
      "delete from shipment where order_id = any($1::uuid[]) returning id",
      [ids],
    );
    await this.pool.query("delete from domain_event where aggregate_id = any($1::uuid[])", [
      shipments.rows.map((row) => row.id),
    ]);
    await deletePaymentsOfOrders(this.pool, ids);
    await this.pool.query("delete from sales_order where id = any($1::uuid[])", [ids]);
    this.numbers.clear();
  }
}

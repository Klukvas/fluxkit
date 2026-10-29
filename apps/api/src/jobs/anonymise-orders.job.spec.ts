import { randomBytes, randomUUID } from "node:crypto";
import { AUDIT_EVENT_RETENTION_DAYS, PRIVACY_REQUEST_RETENTION_DAYS } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivacyRetentionService } from "../privacy/retention/privacy-retention.service.js";
import type { PlacedForAdmin } from "../test/admin-orders-world.js";
import { ShipmentWorld, TEST_POINT_REF } from "../test/shipment-world.js";
import { anonymiseOrders } from "./anonymise-orders.job.js";
import { JobBudget } from "./job-budget.js";

const DAY = 24 * 60 * 60 * 1000;
/** A period long enough that only the rows this spec moves into the far past can be due. */
const DAYS = 3650;

type Row = Record<string, unknown>;

/**
 * Job 12 `anonymise-orders` (ADR 0033 decision 8, privacy plan step 8) on real Postgres: OFF without
 * `ORDER_CONTACT_RETENTION_DAYS`; with it, the contact data of closed orders whose final date is strictly older than the
 * period is anonymised one order per short transaction, blocked orders are skipped, and old privacy requests and audit
 * events are purged.
 */
describe("anonymise-orders (job 12; real Postgres, injected time)", () => {
  const runId = randomBytes(3).toString("hex");
  let world: ShipmentWorld;
  let retention: PrivacyRetentionService;
  let sequence = 0;
  const orderIds: string[] = [];
  const now = new Date();
  const cutoff = new Date(now.getTime() - DAYS * DAY);

  async function order(): Promise<PlacedForAdmin> {
    sequence += 1;
    const method = world.method.pickup;
    if (method === undefined) throw new Error("Test setup bug: no pickup method");
    const placed = await world.orders.place([{ quantity: 1 }], {
      email: `job12-${String(sequence)}-${runId}@example.test`,
      shippingAddress: undefined,
      shipping: { methodCode: method.code, pickupPointRef: TEST_POINT_REF },
    });
    orderIds.push(placed.id);
    return placed;
  }

  /** A cancelled order whose closing time is `closedAt`. */
  async function closedAt(closed: Date): Promise<PlacedForAdmin> {
    const placed = await order();
    expect((await world.orders.cancel(placed.id, "Shop cancelled")).status).toBe(200);
    await world.pool.query(
      `update sales_order set placed_at = $2::timestamptz - interval '1 day', expires_at = $2, cancelled_at = $2
       where id = $1`,
      [placed.id, closed],
    );
    return placed;
  }

  async function row(id: string): Promise<Row> {
    const result = await world.pool.query<Row>("select * from sales_order where id = $1", [id]);
    const found = result.rows[0];
    if (found === undefined) throw new Error("order vanished");
    return found;
  }

  const erased = async (id: string) => (await row(id)).contact_erased_at !== null;
  const run = (days: number | null, options: { budget?: JobBudget; pageSize?: number } = {}) =>
    anonymiseOrders({ retention, retentionDays: days }, now, options);

  beforeAll(async () => {
    world = await ShipmentWorld.start();
    retention = world.orders.owner.app.get(PrivacyRetentionService);
  }, 60_000);

  afterAll(async () => {
    // The orders of this spec wrote domain events; later cleanup specs count every event they find.
    await world.pool.query("delete from domain_event where aggregate_id = any($1::uuid[])", [
      orderIds,
    ]);
    await world.stop();
  });

  it("is off without a retention period: nothing changes, however old", async () => {
    const ancient = await closedAt(new Date("2001-01-01T00:00:00Z"));
    const before = await row(ancient.id);
    expect(await run(null)).toEqual({
      enabled: false,
      anonymised: 0,
      skipped: 0,
      requestsDeleted: 0,
      auditEventsDeleted: 0,
      truncated: false,
    });
    expect(await row(ancient.id)).toEqual(before);
  });

  it("anonymises a closed order strictly older than the period and keeps its accounting data", async () => {
    const old = await closedAt(new Date(cutoff.getTime() - 1));
    const atCutoff = await closedAt(cutoff);
    const recent = await closedAt(new Date(cutoff.getTime() + DAY));
    const open = await order();
    await world.pool.query("update sales_order set placed_at = '2001-01-01' where id = $1", [
      open.id,
    ]);
    const before = await row(old.id);
    const result = await run(DAYS);
    expect(result).toMatchObject({ enabled: true, truncated: false });
    expect(result.anonymised).toBeGreaterThanOrEqual(1);
    const after = await row(old.id);
    expect(after).toMatchObject({
      email: null,
      phone: null,
      first_name: null,
      last_name: null,
      access_token_hash: null,
      cancellation_reason: null,
    });
    expect(after.request_fingerprint).not.toBe(before.request_fingerprint);
    for (const column of ["number", "status", "total_amount", "subtotal_amount", "cancelled_at"]) {
      expect(after[column], column).toEqual(before[column]);
    }
    expect(await erased(atCutoff.id)).toBe(false);
    expect(await erased(recent.id)).toBe(false);
    expect(await erased(open.id)).toBe(false);
  });

  it("counts the newest refund as the final date", async () => {
    const refunded = await closedAt(new Date(cutoff.getTime() - DAY));
    const paymentId = (
      await world.pool.query<{ id: string }>(
        `insert into payment (order_id, provider_code, provider_payment_id, amount, currency, status, expires_at,
           created_by, created_at, refunded_amount)
         values ($1, 'fake', 'p-' || $2, 1000, 'UAH', 'succeeded', now() + interval '1 day', 'admin',
           $3::timestamptz - interval '1 hour', 1000)
         returning id`,
        [refunded.id, randomUUID().slice(0, 8), new Date(cutoff.getTime() - DAY)],
      )
    ).rows[0]?.id;
    await world.pool.query(
      `insert into payment_refund (payment_id, amount, currency, payment_amount, reason, status, created_at)
       values ($1, 1000, 'UAH', 1000, 'admin', 'succeeded', $2)`,
      [paymentId, new Date(cutoff.getTime() + DAY)],
    );
    await run(DAYS);
    expect(await erased(refunded.id)).toBe(false);
    await world.pool.query("delete from payment_refund where payment_id = $1", [paymentId]);
    await world.pool.query("delete from payment where id = $1", [paymentId]);
  });

  it("skips an order with a blocker (an active shipment) and reports it", async () => {
    const paid = await world.paid("pickup");
    orderIds.push(paid.id);
    await world.created(paid.id);
    await world.pool.query(
      `update sales_order set status = 'fulfilled', fulfilled_at = $2, placed_at = $2::timestamptz - interval '1 day',
         expires_at = $2, paid_at = $2 where id = $1`,
      [paid.id, new Date(cutoff.getTime() - DAY)],
    );
    const result = await run(DAYS);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(await erased(paid.id)).toBe(false);
  });

  it("works in pages and stops starting orders when the budget is used up (the rest waits)", async () => {
    const due = [];
    for (let index = 0; index < 5; index += 1) {
      due.push(await closedAt(new Date(cutoff.getTime() - (index + 2) * DAY)));
    }
    let tick = 0;
    const spent = new JobBudget(1, () => (tick += 10));
    const stopped = await run(DAYS, { budget: spent, pageSize: 2 });
    expect(stopped).toMatchObject({ truncated: true, anonymised: 0 });
    const paged = await run(DAYS, { pageSize: 2 });
    expect(paged.truncated).toBe(false);
    for (const placed of due) expect(await erased(placed.id)).toBe(true);
    // A second run finds nothing left.
    expect((await run(DAYS, { pageSize: 2 })).anonymised).toBe(0);
  });

  it("purges closed privacy requests past their retention and audit events past theirs, nothing newer", async () => {
    const requestAge = PRIVACY_REQUEST_RETENTION_DAYS * DAY;
    const insertRequest = async (status: string, completedAgoMs: number | null) => {
      const received = new Date(now.getTime() - (completedAgoMs ?? 0) - 2 * DAY);
      const result = await world.pool.query<{ id: string }>(
        `insert into privacy_request (kind, subject_kind, subject_email_hash, channel, status, received_at, due_at,
           completed_at)
         values ('export', 'email', repeat('f', 64), 'admin', $1, $2, $2::timestamptz + interval '30 days', $3)
         returning id`,
        [
          status,
          received,
          completedAgoMs === null ? null : new Date(now.getTime() - completedAgoMs),
        ],
      );
      return result.rows[0]?.id ?? "";
    };
    const oldClosed = await insertRequest("completed", requestAge + DAY);
    const newClosed = await insertRequest("rejected", requestAge - DAY);
    const oldOpen = await insertRequest("received", null);
    await world.pool.query(
      "update privacy_request set received_at = $2, due_at = $2::timestamptz + interval '30 days' where id = $1",
      [oldOpen, new Date(now.getTime() - requestAge - 10 * DAY)],
    );
    const auditAge = AUDIT_EVENT_RETENTION_DAYS * DAY;
    const audit = async (ageMs: number) => {
      const result = await world.pool.query<{ id: string }>(
        `insert into admin_audit_event (action, target_kind, target_id, created_at)
         values ('customer.unlocked', 'customer', gen_random_uuid(), $1) returning id`,
        [new Date(now.getTime() - ageMs)],
      );
      return result.rows[0]?.id ?? "";
    };
    const oldAudit = await audit(auditAge + DAY);
    const newAudit = await audit(auditAge - DAY);

    const result = await run(DAYS);
    expect(result.requestsDeleted).toBeGreaterThanOrEqual(1);
    expect(result.auditEventsDeleted).toBeGreaterThanOrEqual(1);
    const left = async (table: string, id: string) =>
      (await world.pool.query(`select 1 from ${table} where id = $1`, [id])).rowCount;
    expect(await left("privacy_request", oldClosed)).toBe(0);
    expect(await left("privacy_request", newClosed)).toBe(1);
    expect(await left("privacy_request", oldOpen)).toBe(1);
    expect(await left("admin_audit_event", oldAudit)).toBe(0);
    expect(await left("admin_audit_event", newAudit)).toBe(1);
  });
});

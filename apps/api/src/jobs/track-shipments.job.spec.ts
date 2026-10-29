import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ShippingProviderRegistry } from "../shipping/registry/index.js";
import { ShipmentTrackingService } from "../shipping/shipments/shipment-tracking.service.js";
import { captureLogs, type TestMethod } from "../test/shipping-fixtures.js";
import { ShipmentWorld, TEST_POINT_REF, type ShipmentForTest } from "../test/shipment-world.js";
import {
  SECOND_TEST_PROVIDER_CODE,
  testShippingProviders,
  type TestShippingProvider,
} from "../test/test-shipping-provider.js";
import { JobBudget } from "./job-budget.js";
import { JobsRunner } from "./jobs-runner.js";
import { TRACKING_LIMITS, trackShipments } from "./track-shipments.job.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Row {
  status: string;
  next_track_at: Date | null;
  tracking_attempts: number;
  carrier_status_code: string | null;
}

describe("track-shipments (job 8; real Postgres, injected time, the in-repo test carriers)", () => {
  let world: ShipmentWorld;
  let tracking: ShipmentTrackingService;
  let second: TestShippingProvider;
  let secondMethod: TestMethod;

  beforeAll(async () => {
    world = await ShipmentWorld.start({
      extraShippingProviders: testShippingProviders({ second: true }),
    });
    tracking = world.orders.owner.app.get(ShipmentTrackingService);
    second = world.orders.owner.app
      .get(ShippingProviderRegistry)
      .get(SECOND_TEST_PROVIDER_CODE) as TestShippingProvider;
    secondMethod = await world.methods.create({
      kind: "pickup_point",
      providerCode: SECOND_TEST_PROVIDER_CODE,
      pricing: { type: "flat", amount: 0 },
    });
  });

  beforeEach(() => {
    world.resetProviders();
    second.reset();
    world.clock.advanceMinutes(1);
  });

  afterEach(async () => {
    // Only this test's shipments may be due for the next one.
    await world.orders.placed.cleanup();
  });

  afterAll(async () => {
    await world.stop();
  });

  const run = (now: Date, options: Parameters<typeof trackShipments>[2] = {}) =>
    trackShipments({ tracking }, now, options);

  async function shipped(provider: "fake" | "fake_two" = "fake"): Promise<{
    orderId: string;
    shipment: ShipmentForTest;
  }> {
    // One minute apart, so the due order of the shipments (next_track_at, then id) is the order they were made in.
    world.clock.advanceMinutes(1);
    if (provider === "fake") {
      const order = await world.paid("pickup");
      return { orderId: order.id, shipment: await world.created(order.id) };
    }
    const order = await world.orders.place([{ quantity: 1 }], {
      shippingAddress: undefined,
      shipping: { methodCode: secondMethod.code, pickupPointRef: TEST_POINT_REF },
    });
    expect((await world.orders.pay(order)).status).toBe(200);
    return { orderId: order.id, shipment: await world.created(order.id) };
  }

  async function row(shipmentId: string): Promise<Row> {
    const result = await world.pool.query<Row>(
      "select status, next_track_at, tracking_attempts, carrier_status_code from shipment where id = $1",
      [shipmentId],
    );
    const found = result.rows[0];
    if (found === undefined) throw new Error("no such shipment");
    return found;
  }

  const later = (ms: number) => new Date(world.clock.now().getTime() + ms);

  it("asks the carrier about due shipments only, applies a new status as the system and reschedules by status; never changes the order", async () => {
    const moving = await shipped();
    const resting = await shipped();
    const notDue = await shipped();
    const now = later(2 * HOUR);
    // Created one minute later than the other two: due one minute after `now`.
    await world.pool.query("update shipment set next_track_at = $2 where id = $1", [
      notDue.shipment.id,
      new Date(now.getTime() + MINUTE),
    ]);
    world.provider().setTracking(moving.shipment.trackingNumber ?? "", {
      status: "in_transit",
      carrierStatusCode: "5",
    });
    world.provider().setTracking(resting.shipment.trackingNumber ?? "", {
      status: "created",
      carrierStatusCode: "1",
    });
    const orderBefore = await world.pool.query("select * from sales_order where id = $1", [
      moving.orderId,
    ]);

    const result = await run(now);

    expect(result).toMatchObject({
      scanned: 2,
      changed: 1,
      unchanged: 1,
      providerFailures: 0,
      failures: [],
      truncated: false,
    });
    expect(world.provider().trackRequests).toEqual([
      {
        trackingNumbers: [moving.shipment.trackingNumber, resting.shipment.trackingNumber],
        phones: ["+380501234567"],
      },
    ]);
    expect(await row(moving.shipment.id)).toEqual({
      status: "in_transit",
      next_track_at: new Date(now.getTime() + 4 * HOUR),
      tracking_attempts: 0,
      carrier_status_code: "5",
    });
    expect(await row(resting.shipment.id)).toMatchObject({
      status: "created",
      next_track_at: new Date(now.getTime() + 2 * HOUR),
      carrier_status_code: "1",
    });
    expect((await world.journal(moving.shipment.id)).at(-1)).toEqual({
      from_status: "created",
      to_status: "in_transit",
      carrier_status_code: "5",
      actor_type: "system",
      actor_admin_id: null,
    });
    expect((await world.events(moving.shipment.id)).map((event) => event.payload)).toEqual([
      expect.objectContaining({ status: "created" }),
      {
        shipmentId: moving.shipment.id,
        orderId: moving.orderId,
        orderNumber: moving.shipment.clientReference,
        status: "in_transit",
      },
    ]);
    expect(await world.events(resting.shipment.id)).toHaveLength(1);
    const orderAfter = await world.pool.query("select * from sales_order where id = $1", [
      moving.orderId,
    ]);
    expect(orderAfter.rows).toEqual(orderBefore.rows);
  });

  it("review m-7: a due shipment of a provider that is not loaded is skipped (left as it is), never breaks the job", async () => {
    const orphan = await shipped();
    const tracked = await shipped();
    // The shop stopped running this carrier (SHIPPING_PROVIDERS_ENABLED) after the waybill was made.
    await world.pool.query("update shipment set provider_code = 'gone_provider' where id = $1", [
      orphan.shipment.id,
    ]);
    const before = await row(orphan.shipment.id);
    world.provider().setTracking(tracked.shipment.trackingNumber ?? "", {
      status: "in_transit",
      carrierStatusCode: "5",
    });

    const result = await run(later(2 * HOUR));

    expect(result).toMatchObject({ scanned: 1, changed: 1, failures: [], truncated: false });
    expect(await row(orphan.shipment.id)).toEqual(before);
    expect((await row(tracked.shipment.id)).status).toBe("in_transit");
    expect(world.provider().trackRequests.flatMap((request) => request.trackingNumbers)).toEqual([
      tracked.shipment.trackingNumber,
    ]);
  });

  it("delivered and arrived: arrived is polled every 6 h, delivered is terminal (no next poll); the order stays paid", async () => {
    const arriving = await shipped();
    const delivering = await shipped();
    world.provider().setTracking(arriving.shipment.trackingNumber ?? "", {
      status: "arrived",
      carrierStatusCode: "7",
    });
    world.provider().setTracking(delivering.shipment.trackingNumber ?? "", {
      status: "delivered",
      carrierStatusCode: "9",
    });
    const now = later(3 * HOUR);
    expect((await run(now)).changed).toBe(2);
    expect((await row(arriving.shipment.id)).next_track_at).toEqual(
      new Date(now.getTime() + 6 * HOUR),
    );
    expect(await row(delivering.shipment.id)).toMatchObject({
      status: "delivered",
      next_track_at: null,
    });
    const status = await world.pool.query<{ status: string }>(
      "select status from sales_order where id = $1",
      [delivering.orderId],
    );
    expect(status.rows[0]?.status).toBe("paid");
    // Nothing is due any more for the delivered one.
    expect((await run(new Date(now.getTime() + 30 * DAY))).scanned).toBe(1);
  });

  it("a carrier that fails backs its rows off (5, 10, 20 min ... at most 6 h) while the other carrier's rows are still tracked", async () => {
    const failing = await shipped("fake");
    const working = await shipped("fake_two");
    second.setTracking(working.shipment.trackingNumber ?? "", {
      status: "in_transit",
      carrierStatusCode: "5",
    });
    let now = later(2 * HOUR);
    // Nine failed polls: this run and the eight below; the tenth poll is answered.
    world.provider().failWaybill("track", { reason: "unavailable", times: 9 });
    const first = await run(now);
    expect(first).toMatchObject({ scanned: 2, changed: 1, providerFailures: 1, failures: [] });
    expect(await row(failing.shipment.id)).toMatchObject({
      status: "created",
      tracking_attempts: 1,
      next_track_at: new Date(now.getTime() + 5 * MINUTE),
    });
    expect((await row(working.shipment.id)).status).toBe("in_transit");

    const delays: number[] = [];
    for (let attempt = 2; attempt <= 9; attempt += 1) {
      now = (await row(failing.shipment.id)).next_track_at ?? now;
      await run(now);
      const next = (await row(failing.shipment.id)).next_track_at;
      delays.push(((next?.getTime() ?? 0) - now.getTime()) / MINUTE);
    }
    expect(delays).toEqual([10, 20, 40, 80, 160, 320, 360, 360]);

    // The carrier answers again: the count goes back to 0 and the status interval applies.
    now = (await row(failing.shipment.id)).next_track_at ?? now;
    await run(now);
    expect(await row(failing.shipment.id)).toMatchObject({
      tracking_attempts: 0,
      next_track_at: new Date(now.getTime() + 2 * HOUR),
    });
  });

  it("a carrier that never answers is cut off by the call timeout; its rows back off and the job goes on", async () => {
    const hanging = await shipped("fake");
    const working = await shipped("fake_two");
    world.provider().failWaybill("track", { hang: true });
    const started = performance.now();
    const result = await run(later(2 * HOUR));
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result).toMatchObject({ scanned: 2, providerFailures: 1, unchanged: 1 });
    expect((await row(hanging.shipment.id)).tracking_attempts).toBe(1);
    expect((await row(working.shipment.id)).tracking_attempts).toBe(0);
  });

  it("bounded: pages of the given size, at most the given number of pages; the rest is left due and is first next time (no starvation)", async () => {
    const all = [];
    for (let index = 0; index < 5; index += 1) {
      all.push(await shipped());
    }
    const now = later(3 * HOUR);
    const first = await run(now, { limits: { batchSize: 2, maxBatches: 2 } });
    expect(first).toMatchObject({ scanned: 4, unchanged: 4, truncated: true });
    expect(world.provider().trackRequests.map((request) => request.trackingNumbers.length)).toEqual(
      [2, 2],
    );
    // The one left over is the newest (latest next_track_at); it is the only one due at the next run.
    const leftOver = all.at(-1)?.shipment.id ?? "";
    expect((await row(leftOver)).next_track_at?.getTime()).toBeLessThanOrEqual(now.getTime());
    const next = await run(now, { limits: { batchSize: 2, maxBatches: 2 } });
    expect(next).toMatchObject({ scanned: 1, truncated: false });
    expect(world.provider().trackRequests.at(-1)?.trackingNumbers).toEqual([
      all.at(-1)?.shipment.trackingNumber,
    ]);
    expect(TRACKING_LIMITS).toEqual({ batchSize: 100, maxBatches: 5 });
  });

  it("stops starting pages when its time budget is used up (truncated)", async () => {
    await shipped();
    await shipped();
    let clock = 0;
    const budget = new JobBudget(1_000, () => clock);
    const release = world.provider().hold("track");
    const running = run(later(3 * HOUR), { limits: { batchSize: 1, maxBatches: 5 }, budget });
    for (let attempt = 0; attempt < 200 && world.provider().calls.track === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    clock = 1_000;
    release();
    const result = await running;
    expect(result).toMatchObject({ scanned: 1, truncated: true });
    expect(world.provider().calls.track).toBe(1);
  });

  it("gives up after 30 days without a terminal status: no next poll, logged with the shipment id only", async () => {
    const old = await shipped();
    const logs = captureLogs();
    let result;
    try {
      result = await run(later(31 * DAY));
    } finally {
      logs.stop();
    }
    expect(result).toMatchObject({ scanned: 1, stopped: 1 });
    expect(await row(old.shipment.id)).toMatchObject({ status: "created", next_track_at: null });
    expect(logs.text()).toContain(old.shipment.id);
    expect(logs.text()).not.toContain("380501234567");
    // An admin refresh still works.
    expect((await world.action(old.orderId, old.shipment.id, "refresh")).status).toBe(200);
  });

  it("a shipment whose row is locked fails alone (lock timeout) and the others are still tracked", async () => {
    const stuck = await shipped();
    const fine = await shipped();
    world.provider().setTracking(fine.shipment.trackingNumber ?? "", {
      status: "in_transit",
      carrierStatusCode: "5",
    });
    const holder = await world.pool.connect();
    let result;
    const logs = captureLogs();
    try {
      await holder.query("begin");
      await holder.query("select 1 from shipment where id = $1 for update", [stuck.shipment.id]);
      result = await run(later(3 * HOUR), {
        jobLimits: { statementTimeoutMs: 5_000, lockTimeoutMs: 200 },
      });
    } finally {
      logs.stop();
      await holder.query("rollback");
      holder.release();
    }
    expect(result.failures).toEqual([{ shipmentId: stuck.shipment.id, error: expect.any(String) }]);
    expect(result.changed).toBe(1);
    expect((await row(fine.shipment.id)).status).toBe("in_transit");
    // Still due: the next run tries it again.
    expect((await row(stuck.shipment.id)).next_track_at?.getTime()).toBeLessThan(
      later(3 * HOUR).getTime(),
    );
  });

  it("is job 8 of the tick, after the cleanups and before the mail jobs, and its log has codes only (no phone, no carrier text)", async () => {
    await shipped();
    world.provider().failWaybill("track", { message: "Іван +380501234567 apiKey=SECRET-KEY" });
    const logs = captureLogs();
    let reports;
    try {
      reports = await world.orders.owner.app.get(JobsRunner).runAll(later(3 * HOUR));
    } finally {
      logs.stop();
    }
    expect(reports.map((report) => report.name)).toEqual([
      "expire-orders",
      "sweep-reservations",
      "dispatch-events",
      "delete-dispatched-events",
      "delete-carts",
      "delete-customer-sessions",
      "delete-abandoned-uploads",
      "track-shipments",
      "send-emails",
      "purge-email-messages",
      "reconcile-payments",
    ]);
    expect(reports.find((report) => report.name === "track-shipments")).toMatchObject({
      name: "track-shipments",
      ok: true,
      result: { scanned: 1, providerFailures: 1 },
    });
    const text = logs.text();
    expect(text).toContain("track-shipments");
    for (const needle of ["380501234567", "SECRET-KEY", "Іван", "apiKey"]) {
      expect(text).not.toContain(needle);
    }
  });
});

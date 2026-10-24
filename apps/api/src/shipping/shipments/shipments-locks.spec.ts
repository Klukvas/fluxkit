import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PARCEL, ShipmentWorld } from "../../test/shipment-world.js";
import type { TestOperation } from "../../test/test-shipping-provider.js";

/**
 * No carrier call inside a database transaction or under a lock (ADR 0029 decisions 9 and 10): while the carrier hangs,
 * the order row and the shipment row stay free (`FOR UPDATE NOWAIT` from another connection succeeds) and no connection
 * of the app sits idle in a transaction. The carrier timeout here is 2 s, long enough to probe while it hangs.
 */
describe("shipments: no carrier call under a lock (real Postgres)", () => {
  let world: ShipmentWorld;

  beforeAll(async () => {
    world = await ShipmentWorld.start({
      shipmentCallTimeouts: { waybillMs: 2_000, trackingMs: 2_000, labelMs: 2_000 },
    });
  });

  beforeEach(() => {
    world.resetProviders();
    world.clock.advanceMinutes(1);
  });

  afterAll(async () => {
    await world.stop();
  });

  async function waitForCall(operation: TestOperation): Promise<void> {
    for (let attempt = 0; attempt < 200 && world.provider().calls[operation] === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(world.provider().calls[operation]).toBe(1);
  }

  /** NOWAIT locks on the order and its shipments from another connection; none may be held by the waiting request. */
  async function expectNothingLocked(orderId: string): Promise<void> {
    const probe = await world.pool.connect();
    try {
      await probe.query("begin");
      await probe.query("select 1 from sales_order where id = $1 for update nowait", [orderId]);
      await probe.query("select 1 from shipment where order_id = $1 for update nowait", [orderId]);
      await probe.query("rollback");
      const idle = await probe.query<{ count: number }>(
        `select count(*)::int as count from pg_stat_activity
          where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`,
      );
      expect(idle.rows[0]?.count).toBe(0);
    } finally {
      probe.release();
    }
  }

  it("create: the pending row is committed before the carrier is asked, and nothing is locked while it hangs", async () => {
    const order = await world.paid("pickup");
    world.provider().failWaybill("createWaybill", { hang: true });
    const pending = world.create(order.id);
    await waitForCall("createWaybill");
    // Committed and visible to another connection while the carrier is still being asked.
    expect((await world.shipmentRows(order.id)).map((row) => row["status"])).toEqual(["pending"]);
    await expectNothingLocked(order.id);
    const result = await pending;
    expect(result.body.shipment.status).toBe("unknown");
  });

  it.each(["reconcile", "cancel", "refresh"] as const)(
    "%s: nothing is locked while the carrier hangs",
    async (action) => {
      const order = await world.paid("pickup");
      let shipmentId: string;
      if (action === "reconcile") {
        world.provider().failWaybill("createWaybill", { hang: true });
        shipmentId = (await world.create(order.id)).body.shipment.id;
      } else {
        shipmentId = (await world.created(order.id)).id;
      }
      const operation = { reconcile: "findWaybill", cancel: "cancelWaybill", refresh: "track" }[
        action
      ] as TestOperation;
      world.provider().failWaybill(operation as "findWaybill", { hang: true });
      const pending = world.action(order.id, shipmentId, action);
      await waitForCall(operation);
      await expectNothingLocked(order.id);
      expect((await pending).status).toBe(503);
    },
  );

  it("label: nothing is locked while the carrier hangs", async () => {
    const order = await world.paid("pickup");
    const created = await world.created(order.id);
    world.provider().failWaybill("fetchLabel", { hang: true });
    const pending = world.label(order.id, created.id);
    await waitForCall("fetchLabel");
    await expectNothingLocked(order.id);
    expect((await pending).status).toBe(503);
  });

  it("two creates at once for one order: exactly one carrier call and one shipment; the other is 409 shipment_exists", async () => {
    const order = await world.paid("pickup");
    const release = world.provider().hold("createWaybill");
    const first = world.create(order.id, PARCEL);
    const second = world.create(order.id, PARCEL);
    const settledSecond = await Promise.race([
      second,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_000)),
    ]);
    release();
    const results = [await first, settledSecond ?? (await second)];
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.rule).toBe("shipment_exists");
    expect(world.provider().calls.createWaybill).toBe(1);
    expect(await world.shipmentRows(order.id)).toHaveLength(1);
  });
});

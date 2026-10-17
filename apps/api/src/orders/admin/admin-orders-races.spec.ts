import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunningApp } from "../../test/app.js";
import { AdminOrdersWorld, type PlacedForAdmin } from "../../test/admin-orders-world.js";
import { defaultLocationId, levelOf, movementsOf } from "../../test/inventory-fixtures.js";
import { changesOf, eventsOf, orderRow, reservationsOfOrder } from "../../test/order-http.js";
import { http } from "../../test/http.js";
import { OrdersService } from "../orders.service.js";

const ROUNDS = 12;

describe("admin order actions racing each other and the scheduler: exactly one winner (real Postgres)", () => {
  let world: AdminOrdersWorld;
  let second: RunningApp;
  let service: OrdersService;
  let mainId = "";

  beforeAll(async () => {
    world = await AdminOrdersWorld.start();
    second = await world.extraOwnerApp();
    service = world.owner.app.get(OrdersService);
    mainId = await defaultLocationId(world.pool);
  });

  afterAll(async () => {
    await world.stop();
  });

  const level = async (variantId: string) =>
    (await levelOf(world.pool, variantId, mainId)) ?? { on_hand: -1, reserved: -1 };

  /** Everything that must hold after any race on one order, whoever won. Returns the final status. */
  async function expectConsistent(order: PlacedForAdmin): Promise<string> {
    const row = await orderRow(world.pool, order.number);
    const changes = await changesOf(world.pool, order.id);
    const events = await eventsOf(world.pool, order.id);
    const reservations = await reservationsOfOrder(world.pool, order.id);
    const line = order.lines[0];
    const sales = (await movementsOf(world.pool, line?.variantId ?? "")).filter(
      (movement) => movement.kind === "sale",
    );

    // The journal is a chain: each row starts where the previous one ended, and ends in the status of the order.
    expect(changes[0]).toMatchObject({ from_status: null, to_status: "awaiting_payment" });
    for (let index = 1; index < changes.length; index += 1) {
      expect(changes[index]?.from_status, `journal row ${String(index)}`).toBe(
        changes[index - 1]?.to_status,
      );
    }
    expect(changes.at(-1)?.to_status).toBe(row.status);
    expect(events.map((event) => event.type)).toEqual(
      changes.map((change) =>
        change.to_status === "awaiting_payment"
          ? "order.placed"
          : `order.${change.to_status}`,
      ),
    );

    if (row.status === "paid") {
      expect(changes).toHaveLength(2);
      expect(reservations.map((entry) => entry.status)).toEqual(["committed"]);
      expect(await level(line?.variantId ?? "")).toEqual({
        on_hand: 50 - (line?.quantity ?? 0),
        reserved: 0,
      });
      expect(sales).toHaveLength(1);
      expect(row.paid_at).not.toBeNull();
    } else {
      expect(["cancelled", "expired"]).toContain(row.status);
      expect(changes).toHaveLength(2);
      expect(reservations.map((entry) => entry.status)).toEqual(["released"]);
      expect(await level(line?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 0 });
      expect(sales).toHaveLength(0);
      expect(row.paid_at).toBeNull();
      expect(row.payment_reference).toBeNull();
    }
    return row.status;
  }

  it("mark-paid against the scheduler's expiry", async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await world.place([{ quantity: 2 }]);
      const row = await orderRow(world.pool, order.number);
      const pastExpiry = new Date(row.expires_at.getTime() + 60_000);
      const [paid, expired] = await Promise.all([
        world.pay(order, `RACE-${String(round)}`),
        service.expireOne(order.id, pastExpiry),
      ]);
      const status = await expectConsistent(order);
      outcomes.add(status);
      if (status === "paid") {
        expect(paid.status).toBe(200);
        expect(expired).toBe("not_due");
      } else {
        expect(status).toBe("expired");
        expect(paid.status).toBe(409);
        expect(paid.body).toMatchObject({ rule: "order_not_payable" });
        expect(expired).toBe("expired");
      }
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });

  it("mark-paid against the shopper's own cancel (guest token) and against an admin cancel", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await world.place([{ quantity: 1 }]);
      const [paid, guest] = await Promise.all([
        world.pay(order, `GC-${String(round)}`),
        http(world.owner.baseUrl, "POST", "/store/orders/cancel", {
          body: { number: order.number, accessToken: order.accessToken },
        }),
      ]);
      const status = await expectConsistent(order);
      expect([paid.status, guest.status].sort()).toEqual([200, 409]);
      if (status === "paid") {
        expect(guest.status).toBe(409);
      } else {
        expect(status).toBe("cancelled");
        expect(paid.status).toBe(409);
        expect(paid.body).toMatchObject({ rule: "order_not_payable" });
      }
    }
    const finals = new Set<number>();
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await world.place([{ quantity: 1 }]);
      const [paid, cancelled] = await Promise.all([
        world.pay(order, `AC-${String(round)}`, world.owner),
        world.cancel(order.id, "racing", second),
      ]);
      // An admin may cancel a PAID order too, so the order always ends cancelled: either the cancel came first and the
      // payment was refused (stock released), or the payment came first and the cancel followed (units stay sold).
      expect(cancelled.status).toBe(200);
      const row = await orderRow(world.pool, order.number);
      const changes = await changesOf(world.pool, order.id);
      const line = order.lines[0];
      expect(row.status).toBe("cancelled");
      if (paid.status === 200) {
        expect(changes.map((change) => change.to_status)).toEqual([
          "awaiting_payment",
          "paid",
          "cancelled",
        ]);
        expect(await level(line?.variantId ?? "")).toEqual({ on_hand: 49, reserved: 0 });
        expect((await reservationsOfOrder(world.pool, order.id)).map((e) => e.status)).toEqual([
          "committed",
        ]);
      } else {
        expect(paid.status).toBe(409);
        expect(paid.body).toMatchObject({ rule: "order_not_payable" });
        expect(changes.map((change) => change.to_status)).toEqual(["awaiting_payment", "cancelled"]);
        expect(await level(line?.variantId ?? "")).toEqual({ on_hand: 50, reserved: 0 });
        expect((await reservationsOfOrder(world.pool, order.id)).map((e) => e.status)).toEqual([
          "released",
        ]);
      }
      finals.add(changes.length);
    }
    expect(finals.size).toBeGreaterThan(0);
  });

  it("two parallel payments with the same reference: both answer 200, one journal row, one sale", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await world.place([{ quantity: 3 }]);
      const results = await Promise.all([
        world.pay(order, "SAME-REF", world.owner),
        world.pay(order, "SAME-REF", second),
        world.pay(order, "  SAME-REF ", world.manager),
      ]);
      expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
      expect(await expectConsistent(order)).toBe("paid");
      expect(results[0]?.body).toEqual(results[1]?.body);
    }
  });

  it("two parallel payments with different references: exactly one wins, the loser is a payment_reference_conflict", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await world.place([{ quantity: 1 }]);
      const results = await Promise.all([
        world.pay(order, "REF-ONE", world.owner),
        world.pay(order, "REF-TWO", second),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const loser = results.find((result) => result.status === 409);
      expect(loser?.body).toMatchObject({ code: "rule_violation", rule: "payment_reference_conflict" });
      expect(await expectConsistent(order)).toBe("paid");
      const winner = results.find((result) => result.status === 200);
      expect((await orderRow(world.pool, order.number)).payment_reference).toBe(
        winner?.body.paymentReference,
      );
    }
  });

  it("two parallel cancels and two parallel fulfilments: one 200 and one 409 each", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await world.place([{ quantity: 1 }]);
      const cancels = await Promise.all([
        world.cancel(order.id, "one", world.owner),
        world.cancel(order.id, "two", second),
      ]);
      expect(cancels.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(await expectConsistent(order)).toBe("cancelled");
    }
    for (let round = 0; round < ROUNDS; round += 1) {
      const order = await world.place([{ quantity: 1 }]);
      await world.pay(order, "F-REF");
      const fulfilments = await Promise.all([
        world.fulfil(order.id, world.owner),
        world.fulfil(order.id, second),
      ]);
      expect(fulfilments.map((result) => result.status).sort()).toEqual([200, 409]);
      const changes = await changesOf(world.pool, order.id);
      expect(changes.map((change) => change.to_status)).toEqual([
        "awaiting_payment",
        "paid",
        "fulfilled",
      ]);
      expect(await level(order.lines[0]?.variantId ?? "")).toEqual({ on_hand: 49, reserved: 0 });
    }
  });

  it("orders crossing each other: parallel actions on different orders never block or fail", async () => {
    const orders = await Promise.all(
      Array.from({ length: 6 }, () => world.place([{ quantity: 1 }])),
    );
    const results = await Promise.all(
      orders.map((order, index) =>
        index % 2 === 0 ? world.pay(order, `X-${String(index)}`) : world.cancel(order.id, "x"),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const statuses = await Promise.all(orders.map((order) => expectConsistent(order)));
    expect(statuses).toEqual(["paid", "cancelled", "paid", "cancelled", "paid", "cancelled"]);
  });
});

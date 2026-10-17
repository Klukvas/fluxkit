import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InventoryService } from "../../inventory/admin/inventory.service.js";
import { AdminOrdersWorld, type PlacedForAdmin } from "../../test/admin-orders-world.js";
import { defaultLocationId, levelOf, movementsOf } from "../../test/inventory-fixtures.js";
import { changesOf, eventsOf, orderRow, reservationsOfOrder } from "../../test/order-http.js";
import { OrdersService } from "../orders.service.js";

describe("admin order actions: cancel, mark-paid, mark-fulfilled (real Postgres)", () => {
  let world: AdminOrdersWorld;
  let mainId = "";

  beforeAll(async () => {
    world = await AdminOrdersWorld.start();
    mainId = await defaultLocationId(world.pool);
  });

  afterAll(async () => {
    await world.stop();
  });

  const level = async (variantId: string) =>
    (await levelOf(world.pool, variantId, mainId)) ?? { on_hand: -1, reserved: -1 };

  async function snapshotOf(order: PlacedForAdmin) {
    return {
      row: await orderRow(world.pool, order.number),
      changes: await changesOf(world.pool, order.id),
      events: await eventsOf(world.pool, order.id),
      reservations: (await reservationsOfOrder(world.pool, order.id)).map((entry) => entry.status),
      levels: await Promise.all(order.lines.map((line) => level(line.variantId))),
      sales: (
        await Promise.all(order.lines.map((line) => movementsOf(world.pool, line.variantId)))
      ).map((movements) => movements.map((movement) => movement.kind)),
    };
  }

  async function expireNow(order: PlacedForAdmin): Promise<void> {
    const row = await orderRow(world.pool, order.number);
    const service = world.owner.app.get(OrdersService);
    expect(await service.expireOne(order.id, new Date(row.expires_at.getTime() + 1))).toBe(
      "expired",
    );
  }

  describe("POST /admin/orders/:id/cancel", () => {
    it("cancels an unpaid order: stock is released, the journal names the admin and the reason, one order.cancelled event", async () => {
      const order = await world.place([{ quantity: 2 }, { quantity: 1 }]);
      expect(await Promise.all(order.lines.map((line) => level(line.variantId)))).toEqual([
        { on_hand: 50, reserved: 2 },
        { on_hand: 50, reserved: 1 },
      ]);
      const result = await world.cancel(order.id, "  Customer called  ", world.manager);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body).toMatchObject({
        status: "cancelled",
        cancellationReason: "Customer called",
      });
      expect(result.body.cancelledAt).not.toBeNull();

      const after = await snapshotOf(order);
      expect(after.row).toMatchObject({
        status: "cancelled",
        cancellation_reason: "Customer called",
      });
      expect(after.row.cancelled_at).not.toBeNull();
      expect(after.levels).toEqual([
        { on_hand: 50, reserved: 0 },
        { on_hand: 50, reserved: 0 },
      ]);
      expect(after.reservations).toEqual(["released", "released"]);
      expect(after.changes.at(-1)).toEqual({
        from_status: "awaiting_payment",
        to_status: "cancelled",
        actor_type: "admin",
        actor_admin_id: world.managerId,
        reason: "Customer called",
      });
      expect(after.events.map((event) => event.type)).toEqual(["order.placed", "order.cancelled"]);
      expect(after.events[1]?.payload).toEqual({
        orderId: order.id,
        orderNumber: order.number,
        status: "cancelled",
      });
      // Nothing was sold, nothing is returned: no sale and no return movement.
      expect(after.sales.flat().filter((kind) => kind === "sale" || kind === "return")).toEqual([]);
    });

    it("cancels a PAID order by an admin with a reason: sold units stay sold, nothing is restocked, the reservations stay committed", async () => {
      const order = await world.place([{ quantity: 3 }]);
      expect((await world.pay(order, "BANK-9")).status).toBe(200);
      const before = await snapshotOf(order);
      expect(before.levels).toEqual([{ on_hand: 47, reserved: 0 }]);

      const result = await world.cancel(order.id, "Refunded by bank transfer", world.manager);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body).toMatchObject({
        status: "cancelled",
        cancellationReason: "Refunded by bank transfer",
        paymentReference: "BANK-9",
      });

      const after = await snapshotOf(order);
      expect(after.levels, "no automatic restock").toEqual(before.levels);
      expect(after.sales, "no stock movement is written by the cancel").toEqual(before.sales);
      expect(after.reservations).toEqual(["committed"]);
      expect(after.changes.at(-1)).toEqual({
        from_status: "paid",
        to_status: "cancelled",
        actor_type: "admin",
        actor_admin_id: world.managerId,
        reason: "Refunded by bank transfer",
      });
      expect(after.events.map((event) => event.type)).toEqual([
        "order.placed",
        "order.paid",
        "order.cancelled",
      ]);
      expect(after.row.paid_at).not.toBeNull();
      expect(after.row.cancelled_at).not.toBeNull();
    });

    it("a second cancel is a 409 invalid_transition and writes nothing; so is cancelling a fulfilled or expired order", async () => {
      const twice = await world.place([{ quantity: 1 }]);
      expect((await world.cancel(twice.id, "first")).status).toBe(200);
      const before = await snapshotOf(twice);
      const again = await world.cancel(twice.id, "second");
      expect(again.status).toBe(409);
      expect(again.headers.get("content-type")).toContain("application/problem+json");
      expect(again.body).toMatchObject({ code: "rule_violation", rule: "invalid_transition" });
      expect(await snapshotOf(twice)).toEqual(before);
      expect((await orderRow(world.pool, twice.number)).cancellation_reason).toBe("first");

      const fulfilled = await world.place([{ quantity: 1 }]);
      await world.pay(fulfilled, "REF-F");
      await world.fulfil(fulfilled.id);
      const fulfilledBefore = await snapshotOf(fulfilled);
      const onFulfilled = await world.cancel(fulfilled.id, "too late");
      expect(onFulfilled.status).toBe(409);
      expect(onFulfilled.body).toMatchObject({
        code: "rule_violation",
        rule: "invalid_transition",
      });
      expect(await snapshotOf(fulfilled)).toEqual(fulfilledBefore);

      const expired = await world.place([{ quantity: 1 }]);
      await expireNow(expired);
      const expiredBefore = await snapshotOf(expired);
      const onExpired = await world.cancel(expired.id, "too late");
      expect(onExpired.status).toBe(409);
      expect(onExpired.body).toMatchObject({ code: "rule_violation", rule: "invalid_transition" });
      expect(await snapshotOf(expired)).toEqual(expiredBefore);
    });
  });

  describe("POST /admin/orders/:id/mark-paid", () => {
    it("pays for the exact total: commits the stock, writes sale movements with the admin, the journal, the reference and one event", async () => {
      const order = await world.place([
        { quantity: 2 },
        { quantity: 3, price: 700 },
        { quantity: 1, digital: true },
      ]);
      const result = await world.pay(order, "  BANK-42  ", world.manager);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body).toMatchObject({ status: "paid", paymentReference: "BANK-42" });
      expect(result.headers.get("cache-control")).toBe("no-store");

      const after = await snapshotOf(order);
      expect(after.row).toMatchObject({ status: "paid", payment_reference: "BANK-42" });
      expect(after.levels.slice(0, 2)).toEqual([
        { on_hand: 48, reserved: 0 },
        { on_hand: 47, reserved: 0 },
      ]);
      for (const line of order.lines.slice(0, 2)) {
        const sales = (await movementsOf(world.pool, line.variantId)).filter(
          (movement) => movement.kind === "sale",
        );
        expect(sales).toEqual([
          expect.objectContaining({
            delta: -line.quantity,
            reference: order.number,
            actor_id: world.managerId,
          }),
        ]);
      }
      expect(after.changes.at(-1)).toEqual({
        from_status: "awaiting_payment",
        to_status: "paid",
        actor_type: "admin",
        actor_admin_id: world.managerId,
        reason: null,
      });
      expect(after.events.map((event) => event.type)).toEqual(["order.placed", "order.paid"]);
      expect(after.row.paid_at).not.toBeNull();
    });

    it("a repeated payment with the same reference answers 200 and changes nothing, even with spaces around it", async () => {
      const order = await world.place([{ quantity: 2 }]);
      const first = await world.pay(order, "BANK-1");
      expect(first.status).toBe(200);
      const before = await snapshotOf(order);
      for (const reference of ["BANK-1", "  BANK-1\t"]) {
        const again = await world.pay(order, reference, world.manager);
        expect(again.status, reference).toBe(200);
        expect(again.body).toEqual(first.body);
      }
      expect(await snapshotOf(order)).toEqual(before);
      expect(before.changes.filter((change) => change.to_status === "paid")).toHaveLength(1);
      expect(before.events.filter((event) => event.type === "order.paid")).toHaveLength(1);
    });

    it("another reference on a paid order is a 409 payment_reference_conflict, also after fulfilment, and changes nothing", async () => {
      const order = await world.place([{ quantity: 1 }]);
      await world.pay(order, "BANK-A");
      const paidBefore = await snapshotOf(order);
      const conflict = await world.pay(order, "BANK-B");
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        code: "rule_violation",
        rule: "payment_reference_conflict",
      });
      expect(await snapshotOf(order)).toEqual(paidBefore);

      await world.fulfil(order.id);
      const fulfilledBefore = await snapshotOf(order);
      expect((await world.pay(order, "BANK-B")).body).toMatchObject({
        rule: "payment_reference_conflict",
      });
      const same = await world.pay(order, "BANK-A");
      expect(same.status).toBe(200);
      expect(same.body.status).toBe("fulfilled");
      expect(await snapshotOf(order)).toEqual(fulfilledBefore);
    });

    it("refuses a wrong amount or currency with 409 amount_mismatch, also on an order that is already paid", async () => {
      const order = await world.place([{ quantity: 2 }]);
      const before = await snapshotOf(order);
      for (const amount of [
        { amount: order.total - 1, currency: "UAH" },
        { amount: order.total + 1, currency: "UAH" },
        { amount: 0, currency: "UAH" },
        { amount: 10 ** 12, currency: "UAH" },
        { amount: order.total, currency: "USD" },
      ]) {
        const result = await world.markPaid(order.id, { reference: "REF-X", amount });
        expect(result.status, JSON.stringify(amount)).toBe(409);
        expect(result.body).toMatchObject({ code: "rule_violation", rule: "amount_mismatch" });
      }
      expect(await snapshotOf(order)).toEqual(before);

      expect((await world.pay(order, "REF-OK")).status).toBe(200);
      const wrongAgain = await world.markPaid(order.id, {
        reference: "REF-OK",
        amount: { amount: order.total + 5, currency: "UAH" },
      });
      expect(wrongAgain.status).toBe(409);
      expect(wrongAgain.body).toMatchObject({ rule: "amount_mismatch" });
    });

    it("an expired or cancelled order is 409 order_not_payable and changes nothing (the stock is not taken twice)", async () => {
      const expired = await world.place([{ quantity: 2 }]);
      await expireNow(expired);
      const cancelled = await world.place([{ quantity: 2 }]);
      await world.cancel(cancelled.id, "no longer wanted");
      for (const order of [expired, cancelled]) {
        const before = await snapshotOf(order);
        const result = await world.pay(order, "LATE-1");
        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({ code: "rule_violation", rule: "order_not_payable" });
        expect(await snapshotOf(order)).toEqual(before);
        expect((await orderRow(world.pool, order.number)).payment_reference).toBeNull();
        expect(before.levels).toEqual([{ on_hand: 50, reserved: 0 }]);
      }
    });

    it("an order whose reservation was swept is 409 order_not_payable", async () => {
      const order = await world.place([{ quantity: 1 }, { quantity: 2 }]);
      const held = await reservationsOfOrder(world.pool, order.id);
      await world.pool.query("update reservation set status = 'expired' where id = $1", [
        held[0]?.id,
      ]);
      const before = await snapshotOf(order);
      const result = await world.pay(order, "SWEPT-1");
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ rule: "order_not_payable" });
      expect(await snapshotOf(order)).toEqual(before);
      // The test touched the reservation behind the stock's back: put the figures right for the cleanup.
      await world.pool.query("update reservation set status = 'active' where id = $1", [
        held[0]?.id,
      ]);
    });

    it("backorder: commits what is on hand, holds the rest, and mark-fulfilled waits for the stock (409 awaiting_stock, all rolled back)", async () => {
      const order = await world.place([
        { quantity: 2 },
        { quantity: 3, onHand: 1, allowBackorder: true },
      ]);
      const paid = await world.pay(order, "BACKORDER-1");
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      const [onHandLine, backorderLine] = order.lines;
      expect(await level(onHandLine?.variantId ?? "")).toEqual({ on_hand: 48, reserved: 0 });
      expect(await level(backorderLine?.variantId ?? "")).toEqual({ on_hand: 1, reserved: 3 });
      expect(paid.body.items.map((item) => item.reservations)).toEqual([
        [{ status: "committed", quantity: 2 }],
        [{ status: "active", quantity: 3 }],
      ]);

      const before = await snapshotOf(order);
      const refused = await world.fulfil(order.id);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "rule_violation", rule: "awaiting_stock" });
      expect(await snapshotOf(order), "everything is rolled back").toEqual(before);

      const inventory = world.owner.app.get(InventoryService, { strict: false });
      await inventory.adjust(
        backorderLine?.productId ?? "",
        backorderLine?.variantId ?? "",
        { kind: "receipt", delta: 5 },
        null,
      );
      const fulfilled = await world.fulfil(order.id, world.manager);
      expect(fulfilled.status, JSON.stringify(fulfilled.body)).toBe(200);
      expect(fulfilled.body.status).toBe("fulfilled");
      expect(await level(backorderLine?.variantId ?? "")).toEqual({ on_hand: 3, reserved: 0 });
      expect(fulfilled.body.items.map((item) => item.reservations)).toEqual([
        [{ status: "committed", quantity: 2 }],
        [{ status: "committed", quantity: 3 }],
      ]);
      const sales = (await movementsOf(world.pool, backorderLine?.variantId ?? "")).filter(
        (movement) => movement.kind === "sale",
      );
      expect(sales).toEqual([
        expect.objectContaining({ delta: -3, actor_id: world.managerId, reference: order.number }),
      ]);
    });
  });

  describe("POST /admin/orders/:id/mark-fulfilled", () => {
    it("fulfils a paid order once; the journal names the admin; a second call and an unpaid order are 409 invalid_transition", async () => {
      const order = await world.place([{ quantity: 1 }]);
      const unpaid = await world.fulfil(order.id);
      expect(unpaid.status).toBe(409);
      expect(unpaid.body).toMatchObject({ code: "rule_violation", rule: "invalid_transition" });
      expect((await orderRow(world.pool, order.number)).status).toBe("awaiting_payment");

      await world.pay(order, "REF-1");
      const done = await world.fulfil(order.id, world.manager);
      expect(done.status).toBe(200);
      expect(done.body.status).toBe("fulfilled");
      expect(done.body.fulfilledAt).not.toBeNull();
      const after = await snapshotOf(order);
      expect(after.changes.at(-1)).toEqual({
        from_status: "paid",
        to_status: "fulfilled",
        actor_type: "admin",
        actor_admin_id: world.managerId,
        reason: null,
      });
      expect(after.events.map((event) => event.type)).toEqual([
        "order.placed",
        "order.paid",
        "order.fulfilled",
      ]);

      const again = await world.fulfil(order.id);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ rule: "invalid_transition" });
      expect(await snapshotOf(order)).toEqual(after);
    });

    it("cancelled and expired orders can not be fulfilled", async () => {
      const cancelled = await world.place([{ quantity: 1 }]);
      await world.cancel(cancelled.id, "x");
      const expired = await world.place([{ quantity: 1 }]);
      await expireNow(expired);
      for (const order of [cancelled, expired]) {
        const before = await snapshotOf(order);
        const result = await world.fulfil(order.id);
        expect(result.status).toBe(409);
        expect(result.body.rule).toBe("invalid_transition");
        expect(await snapshotOf(order)).toEqual(before);
      }
    });
  });
});

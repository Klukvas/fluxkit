import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findPostgresError } from "../common/postgres-errors.js";
import { withTransaction } from "../common/transaction.js";
import { IntegrationsRepository } from "../integrations/integrations.repository.js";
import { checkoutAs, checkoutBody } from "../test/order-http.js";
import { PaymentWorld } from "../test/payment-world.js";
import { Shopper } from "../test/shopper.js";
import { PaymentProviders } from "./registry/payment-providers.js";
import { StorePaymentViews } from "./store/store-payment-views.js";

describe("managed payment transaction failures (real Postgres)", () => {
  let world: PaymentWorld;
  beforeAll(async () => {
    world = await PaymentWorld.start({ paymentDelegated: true });
  });
  afterAll(async () => {
    if (world !== undefined) await world.stop();
  });
  it.each(["availability", "bound refund client", "webhook fact authority", "export metadata"])(
    "rolls back caller writes on a non-readiness SQL error in %s",
    async (operation) => {
      const source = world.app.app.get(PaymentProviders);
      const before = await world.pool.query<{ revision: number }>(
        "select revision from integration_revision where id=1",
      );
      const bound = { providerCode: "monobank", integrationCredentialVersionId: randomUUID() };
      const pending = withTransaction(world.orders.db, async (tx) => {
        await tx.execute(sql`update integration_revision set revision=revision+1 where id=1`);
        // A genuine server-side undefined_table error on the payment read, without changing schema.
        await tx.execute(sql`set local search_path = pg_catalog`);
        switch (operation) {
          case "availability":
            return world.app.app.get(StorePaymentViews).canPay(
              {
                id: randomUUID(),
                status: "awaiting_payment",
                totalAmount: 1000,
                currency: "UAH",
                expiresAt: new Date(Date.now() + 60000),
              },
              [],
              tx,
            );
          case "bound refund client":
            return source.forPayment(bound, tx);
          case "webhook fact authority":
            return source.assertFactAuthority(tx, bound, bound.integrationCredentialVersionId);
          default:
            return source.processorCodes(tx);
        }
      });
      await expect(pending.then(() => undefined, findPostgresError)).resolves.toMatchObject({
        code: "42P01",
      });
      expect(
        (await world.pool.query("select revision from integration_revision where id=1")).rows,
      ).toEqual(before.rows);
    },
  );
  it("commits the checkout order and reservations after a real availability statement timeout", async () => {
    const shopper = new Shopper(world.app.baseUrl);
    const { variantId } = await world.orders.catalog.simple({
      trackInventory: true,
      onHand: 5,
      price: 1000,
    });
    expect((await shopper.post("/store/cart/items", { variantId, quantity: 2 })).status).toBe(200);
    let sqlState: string | undefined;
    const probe = vi
      .spyOn(world.app.app.get(IntegrationsRepository), "currentRevision")
      .mockImplementationOnce(async (executor = world.orders.db) => {
        await executor.execute(sql`set local statement_timeout = '20ms'`);
        try {
          await executor.execute(sql`select pg_sleep(0.1)`);
        } catch (error) {
          sqlState = findPostgresError(error)?.code;
          throw error;
        }
        throw new Error("The availability SQL did not time out");
      });
    try {
      const result = await checkoutAs(shopper, checkoutBody(2000));
      expect(sqlState).toBe("57014");
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      const number = world.orders.placed.track(result.body.order?.number ?? "");
      expect(result.body.order?.payment).toMatchObject({ canPay: false });
      const committed = await world.pool.query<{ id: string }>(
        "select id from sales_order where number=$1",
        [number],
      );
      expect(committed.rows, "a 201 checkout must refer to a committed order").toHaveLength(1);
      const reservations = await world.pool.query<{ quantity: number }>(
        `select r.quantity from reservation r
         join order_item_reservation link on link.reservation_id=r.id
         join order_item item on item.id=link.order_item_id where item.order_id=$1`,
        [committed.rows[0]?.id],
      );
      expect(reservations.rows).toEqual([{ quantity: 2 }]);
      expect((await shopper.get<{ lines: unknown[] }>("/store/cart")).body.lines).toEqual([]);
    } finally {
      probe.mockRestore();
    }
  });
  it.each(["availability", "bound client"])(
    "propagates unexpected %s errors from the caller transaction",
    async (operation) => {
      const failure = new TypeError("unexpected payment read failure");
      const repository = world.app.app.get(IntegrationsRepository);
      const probe =
        operation === "availability"
          ? vi.spyOn(repository, "currentRevision").mockRejectedValueOnce(failure)
          : vi.spyOn(repository, "findVersion").mockRejectedValueOnce(failure);
      try {
        await expect(
          withTransaction<unknown>(world.orders.db, (tx) =>
            operation === "availability"
              ? world.app.app.get(StorePaymentViews).canPay(
                  {
                    id: randomUUID(),
                    status: "awaiting_payment",
                    totalAmount: 1000,
                    currency: "UAH",
                    expiresAt: new Date(Date.now() + 60000),
                  },
                  [],
                  tx,
                )
              : world.app.app.get(PaymentProviders).forPayment(
                  {
                    providerCode: "monobank",
                    integrationCredentialVersionId: randomUUID(),
                  },
                  tx,
                ),
          ),
        ).rejects.toBe(failure);
      } finally {
        probe.mockRestore();
      }
    },
  );
});

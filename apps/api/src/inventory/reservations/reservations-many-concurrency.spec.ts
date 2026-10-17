import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  caller,
  createCatalogFixture,
  type CatalogFixture,
  type OptionFixture,
} from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import {
  defaultLocationId,
  expectJournalReplays,
  insertAdminUserRow,
  levelCount,
  levelOf,
  movementsOf,
  ownerAuthenticator,
} from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { priceProductVariants } from "../../test/pricing-fixtures.js";
import { expectWaitsForLock, holdOpen, inTransaction, lockRow } from "../../test/reservation-tx.js";
import { expectLevelInvariants, reservationsOf, StockWorld } from "../../test/stock-world.js";
import {
  ReservationsService,
  type ReserveManyLine,
  type ReserveManyResult,
} from "./reservations.service.js";

const HOUR = 3_600_000;

/**
 * Real parallel transactions on one Postgres, the way the checkout calls the service (plan step 5a): the row locks,
 * not the test, decide who wins. A deadlock would surface as a rejected promise (`40P01`), so every parallel block
 * runs with `allSettled` and expects every call to be fulfilled.
 */
describe("transaction-scoped reservations under concurrency (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let fx: CatalogFixture;
  let world: StockWorld;
  let service: ReservationsService;
  let database: Database;
  let mainId = "";
  let actorId = "";
  let call: ReturnType<typeof caller>;

  const future = () => new Date(Date.now() + HOUR);
  const past = () => new Date(Date.now() - HOUR);

  function reserveMany(
    lines: ReserveManyLine[],
    reference: string | null = "ORD-CONC",
    expiresAt = future(),
  ): Promise<ReserveManyResult> {
    return inTransaction(database, (tx) =>
      service.reserveMany(tx, lines, { expiresAt, reference }),
    );
  }

  /** Every call must finish (no deadlock victim, no unexpected error); returns the values, keeping tuple types. */
  async function allFulfilled<T extends readonly unknown[]>(
    calls: readonly [...{ [K in keyof T]: Promise<T[K]> }],
  ): Promise<T> {
    const settled = await Promise.allSettled(calls);
    const failures = settled.filter(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    );
    expect(
      failures.map((entry) => String(entry.reason)),
      "no call may fail (a deadlock is a failure)",
    ).toEqual([]);
    // Every promise has settled and none rejected, so this only collects the values.
    return (await Promise.all(calls)) as T;
  }

  async function reservedLine(result: ReserveManyResult, index: number) {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("reserveMany refused");
    }
    const line = result.lines[index];
    if (line?.kind !== "reserved") {
      throw new Error("expected a reserved line");
    }
    return line.reservation;
  }

  /** A fixed pseudo-random order, so a failure can be repeated. */
  function shuffled<T>(items: readonly T[], seed: number): T[] {
    const copy = [...items];
    let state = seed;
    for (let index = copy.length - 1; index > 0; index -= 1) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      const other = state % (index + 1);
      [copy[index], copy[other]] = [copy[other] as T, copy[index] as T];
    }
    return copy;
  }

  beforeAll(async () => {
    await ensureMigrated();
    actorId = await insertAdminUserRow(pool);
    running = await startApp({ adminAuthenticator: ownerAuthenticator(actorId) });
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    service = running.app.get(ReservationsService, { strict: false });
    database = running.app.get<Database>(DRIZZLE, { strict: false });
    mainId = await defaultLocationId(pool);
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.query("delete from admin_user where id = $1", [actorId]);
    await pool.end();
  });

  describe("last unit and all or nothing", () => {
    it("lets exactly one of 10 parallel multi-line orders take the last unit; the losers write nothing", async () => {
      for (let round = 0; round < 4; round += 1) {
        const last = await world.variant({ onHand: 1 });
        const plenty = await world.variant({ onHand: 100 });
        const lines = (flip: boolean): ReserveManyLine[] => {
          const both = [
            { variantId: last.variantId, quantity: 1 },
            { variantId: plenty.variantId, quantity: 1 },
          ];
          return flip ? both.reverse() : both;
        };
        const results = await allFulfilled(
          Array.from({ length: 10 }, (_, index) =>
            reserveMany(lines(index % 2 === 1), `ORD-${round}-${index}`),
          ),
        );
        const winners = results.flatMap((result, index) => (result.ok ? [index] : []));
        expect(winners, `round ${round}`).toHaveLength(1);
        for (const result of results.filter((entry) => !entry.ok)) {
          expect(result).toEqual({
            ok: false,
            refusals: [{ variantId: last.variantId, reason: "insufficient_stock" }],
          });
        }
        expect(await levelOf(pool, last.variantId, mainId)).toEqual({ on_hand: 1, reserved: 1 });
        // The losers' other line (plenty) was evaluated fine but must not have been held.
        expect(await levelOf(pool, plenty.variantId, mainId)).toEqual({
          on_hand: 100,
          reserved: 1,
        });
        const lastRows = await reservationsOf(pool, last.variantId);
        const plentyRows = await reservationsOf(pool, plenty.variantId);
        expect(lastRows).toHaveLength(1);
        expect(plentyRows).toHaveLength(1);
        expect(lastRows[0]?.reference).toBe(`ORD-${round}-${winners[0]}`);
        expect(plentyRows[0]?.reference).toBe(`ORD-${round}-${winners[0]}`);
        await expectLevelInvariants(pool, last.variantId, mainId);
        await expectLevelInvariants(pool, plenty.variantId, mainId);
      }
    });

    it("never holds more than is on hand: 12 parallel orders of 2 from 5 units win exactly twice", async () => {
      const entry = await world.variant({ onHand: 5 });
      const results = await allFulfilled(
        Array.from({ length: 12 }, (_, index) =>
          reserveMany([{ variantId: entry.variantId, quantity: 2 }], `ORD-${index}`),
        ),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(2);
      expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 5, reserved: 4 });
      await expectLevelInvariants(pool, entry.variantId, mainId);
    });

    it("leaves no empty level row behind when parallel orders with a backorder line are all refused", async () => {
      for (let round = 0; round < 3; round += 1) {
        const backorder = await world.variant({ allowBackorder: true });
        const empty = await world.variant(); // tracked, nothing on hand, no backorder: always refused
        const results = await allFulfilled(
          Array.from({ length: 8 }, () =>
            reserveMany([
              { variantId: backorder.variantId, quantity: 3 },
              { variantId: empty.variantId, quantity: 1 },
            ]),
          ),
        );
        for (const result of results) {
          expect(result).toEqual({
            ok: false,
            refusals: [{ variantId: empty.variantId, reason: "insufficient_stock" }],
          });
        }
        expect(await levelCount(pool, backorder.variantId), `round ${round}`).toBe(0);
        expect(await reservationsOf(pool, backorder.variantId)).toHaveLength(0);
        expect(await levelCount(pool, empty.variantId)).toBe(0);
      }
    });

    it("serializes parallel first reservations of a backorder variant into one level row", async () => {
      const backorder = await world.variant({ allowBackorder: true });
      const scarce = await world.variant({ onHand: 1 });
      const results = await allFulfilled(
        Array.from({ length: 10 }, () =>
          reserveMany([
            { variantId: backorder.variantId, quantity: 3 },
            { variantId: scarce.variantId, quantity: 1 },
          ]),
        ),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(await levelCount(pool, backorder.variantId)).toBe(1);
      expect(await levelOf(pool, backorder.variantId, mainId)).toEqual({ on_hand: 0, reserved: 3 });
      expect(await levelOf(pool, scarce.variantId, mainId)).toEqual({ on_hand: 1, reserved: 1 });
      await expectLevelInvariants(pool, backorder.variantId, mainId, { allowBackorder: true });
    });
  });

  describe("crossing variant sets (deadlock)", () => {
    it("does not deadlock when carts with the same variants in opposite orders reserve in parallel (30 rounds)", async () => {
      const a = await world.variant({ onHand: 1000 });
      const b = await world.variant({ onHand: 1000 });
      const c = await world.variant({ onHand: 1000 });
      const orders = [
        [a, b, c],
        [c, b, a],
        [b, c, a],
        [a, c, b],
        [c, a, b],
        [b, a, c],
      ];
      for (let round = 0; round < 30; round += 1) {
        const results = await allFulfilled(
          orders.map((order, index) =>
            reserveMany(
              order.map((entry) => ({ variantId: entry.variantId, quantity: 1 })),
              `ORD-${round}-${index}`,
            ),
          ),
        );
        expect(
          results.every((result) => result.ok),
          `round ${round}`,
        ).toBe(true);
      }
      for (const entry of [a, b, c]) {
        expect(await levelOf(pool, entry.variantId, mainId)).toEqual({
          on_hand: 1000,
          reserved: 180,
        });
        await expectLevelInvariants(pool, entry.variantId, mainId);
      }
    });

    it("does not deadlock with 20 variants in different random orders (8 carts, 10 rounds)", async () => {
      const variants: Awaited<ReturnType<typeof world.variant>>[] = [];
      for (let index = 0; index < 20; index += 1) {
        variants.push(await world.variant({ onHand: 1000 }));
      }
      for (let round = 0; round < 10; round += 1) {
        const results = await allFulfilled(
          Array.from({ length: 8 }, (_, cart) =>
            reserveMany(
              shuffled(variants, round * 100 + cart + 1).map((entry) => ({
                variantId: entry.variantId,
                quantity: 1,
              })),
            ),
          ),
        );
        expect(results.every((result) => result.ok)).toBe(true);
      }
      for (const entry of variants) {
        expect(await levelOf(pool, entry.variantId, mainId)).toEqual({
          on_hand: 1000,
          reserved: 80,
        });
      }
    });

    it("gives consistent outcomes when crossing carts compete for scarce stock (3 units, 8 carts, 6 rounds)", async () => {
      for (let round = 0; round < 6; round += 1) {
        const a = await world.variant({ onHand: 3 });
        const b = await world.variant({ onHand: 3 });
        const results = await allFulfilled(
          Array.from({ length: 8 }, (_, index) =>
            reserveMany(
              (index % 2 === 0 ? [a, b] : [b, a]).map((entry) => ({
                variantId: entry.variantId,
                quantity: 1,
              })),
            ),
          ),
        );
        expect(
          results.filter((result) => result.ok),
          `round ${round}`,
        ).toHaveLength(3);
        for (const result of results.filter((entry) => !entry.ok)) {
          if (result.ok) {
            continue;
          }
          expect(result.refusals.map((refusal) => refusal.reason)).toEqual([
            "insufficient_stock",
            "insufficient_stock",
          ]);
        }
        expect(await levelOf(pool, a.variantId, mainId)).toEqual({ on_hand: 3, reserved: 3 });
        expect(await levelOf(pool, b.variantId, mainId)).toEqual({ on_hand: 3, reserved: 3 });
        await expectLevelInvariants(pool, a.variantId, mainId);
        await expectLevelInvariants(pool, b.variantId, mainId);
      }
    });
  });

  describe("against admin writes", () => {
    it("keeps reserved at or below on hand when orders race manual stock removals (product lock, then level)", async () => {
      for (let round = 0; round < 3; round += 1) {
        const target = await world.variant({ onHand: 6 });
        const other = await world.variant({ onHand: 50 });
        const path = `/admin/products/${target.productId}/variants/${target.variantId}/inventory/adjustments`;
        const [orders, adjustments] = await Promise.all([
          allFulfilled(
            Array.from({ length: 6 }, (_, index) =>
              reserveMany(
                index % 2 === 0
                  ? [
                      { variantId: target.variantId, quantity: 1 },
                      { variantId: other.variantId, quantity: 1 },
                    ]
                  : [
                      { variantId: other.variantId, quantity: 1 },
                      { variantId: target.variantId, quantity: 1 },
                    ],
              ),
            ),
          ),
          allFulfilled(
            Array.from({ length: 6 }, () => call("POST", path, { delta: -1, kind: "adjustment" })),
          ),
        ]);
        const level = await expectLevelInvariants(pool, target.variantId, mainId);
        const reserved = orders.filter((result) => result.ok).length;
        const removed = adjustments.filter((result) => result.status === 201).length;
        expect(level.reserved, `round ${round}`).toBe(reserved);
        expect(level.onHand).toBe(6 - removed);
        expect(reserved + removed, "no unit is both held and removed").toBeLessThanOrEqual(6);
        expectJournalReplays(await movementsOf(pool, target.variantId), level.onHand);
        // Only the orders that won took the other variant's unit.
        expect((await expectLevelInvariants(pool, other.variantId, mainId)).reserved).toBe(
          reserved,
        );
      }
    });

    it("agrees with a parallel unpublish: the order either holds the units or is refused, never both", async () => {
      for (let round = 0; round < 8; round += 1) {
        const entry = await world.variant({ onHand: 3 });
        const [result, unpublished] = await Promise.all([
          reserveMany([{ variantId: entry.variantId, quantity: 1 }]),
          call("POST", `/admin/products/${entry.productId}/unpublish`),
        ]);
        expect(unpublished.status, JSON.stringify(unpublished.body)).toBe(200);
        const rows = await reservationsOf(pool, entry.variantId);
        if (result.ok) {
          expect(rows, `round ${round}`).toHaveLength(1);
          expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 3, reserved: 1 });
        } else {
          expect(result).toEqual({
            ok: false,
            refusals: [{ variantId: entry.variantId, reason: "variant_not_sellable" }],
          });
          expect(rows).toHaveLength(0);
          expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 3, reserved: 0 });
        }
        await expectLevelInvariants(pool, entry.variantId, mainId);
      }
    });

    it("agrees with a parallel allowBackorder switch-off on a variant without stock", async () => {
      for (let round = 0; round < 8; round += 1) {
        const entry = await world.variant({ allowBackorder: true });
        const path = `/admin/products/${entry.productId}/variants/${entry.variantId}`;
        const [result, patched] = await Promise.all([
          reserveMany([{ variantId: entry.variantId, quantity: 2 }]),
          call("PATCH", path, { allowBackorder: false }),
        ]);
        expect(patched.status, JSON.stringify(patched.body)).toBe(200);
        const rows = await reservationsOf(pool, entry.variantId);
        if (result.ok) {
          // The order got in first (the PATCH waited): a backorder hold of a variant that allowed it at that moment.
          expect(rows).toHaveLength(1);
          expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 0, reserved: 2 });
        } else {
          expect(result).toEqual({
            ok: false,
            refusals: [{ variantId: entry.variantId, reason: "insufficient_stock" }],
          });
          expect(rows).toHaveLength(0);
          expect(await levelCount(pool, entry.variantId)).toBe(0);
        }
      }
    });

    it("waits for a product writer and then sees its change (unpublish, price removal, variant delete)", async () => {
      const unpublished = await world.variant({ onHand: 3 });
      const unpublishedResult = await expectWaitsForLock(
        pool,
        async (client) => {
          await lockRow(client, "product", unpublished.productId);
          await client.query("update product set status = 'draft' where id = $1", [
            unpublished.productId,
          ]);
        },
        () => reserveMany([{ variantId: unpublished.variantId, quantity: 1 }]),
        "reserveMany",
      );
      expect(unpublishedResult).toEqual({
        ok: false,
        refusals: [{ variantId: unpublished.variantId, reason: "variant_not_sellable" }],
      });

      const repriced = await world.variant({ onHand: 3 });
      const repricedResult = await expectWaitsForLock(
        pool,
        async (client) => {
          await lockRow(client, "product", repriced.productId);
          await client.query("delete from price where variant_id = $1", [repriced.variantId]);
        },
        () => reserveMany([{ variantId: repriced.variantId, quantity: 1 }]),
        "reserveMany",
      );
      expect(repricedResult).toEqual({
        ok: false,
        refusals: [{ variantId: repriced.variantId, reason: "variant_not_sellable" }],
      });

      const deleted = await world.variant({ onHand: 0 });
      const deletedResult = await expectWaitsForLock(
        pool,
        async (client) => {
          await lockRow(client, "product", deleted.productId);
          await client.query("delete from variant where id = $1", [deleted.variantId]);
        },
        () => reserveMany([{ variantId: deleted.variantId, quantity: 1 }]),
        "reserveMany",
      );
      expect(deletedResult).toEqual({
        ok: false,
        refusals: [{ variantId: deleted.variantId, reason: "variant_not_found" }],
      });
    });

    it("waits for a variant writer and decides with the flags it committed", async () => {
      const entry = await world.variant({ allowBackorder: true });
      const result = await expectWaitsForLock(
        pool,
        async (client) => {
          await lockRow(client, "variant", entry.variantId);
          await client.query("update variant set allow_backorder = false where id = $1", [
            entry.variantId,
          ]);
        },
        () => reserveMany([{ variantId: entry.variantId, quantity: 1 }]),
        "reserveMany",
      );
      expect(result).toEqual({
        ok: false,
        refusals: [{ variantId: entry.variantId, reason: "insufficient_stock" }],
      });
      expect(await levelCount(pool, entry.variantId)).toBe(0);
    });

    it("holds the product and variant rows until the caller commits: an unpublish waits for an order in progress", async () => {
      const entry = await world.variant({ onHand: 3 });
      const held = await holdOpen(database, (tx) =>
        service.reserveMany(tx, [{ variantId: entry.variantId, quantity: 1 }], {
          expiresAt: future(),
          reference: "ORD-HELD",
        }),
      );
      expect(held.result.ok).toBe(true);
      let settled = false;
      const unpublish = call("POST", `/admin/products/${entry.productId}/unpublish`).then(
        (result) => {
          settled = true;
          return result;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled, "the unpublish must wait for the order's product lock").toBe(false);
      await held.release();
      expect((await unpublish).status).toBe(200);
      // The order got in first; the snapshot it took is valid, and the hold stays.
      expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 3, reserved: 1 });
    });

    it("a variant delete cannot slip in between an order and the unpublish it needs: it is refused for the stock history (ADR 0013)", async () => {
      // A published product with two variants (deleting the only variant is refused for another reason).
      const created = await world.createProduct();
      const withOptions = await call<{ id: string; variants: { id: string }[] }>(
        "PUT",
        `/admin/products/${created.id}/options`,
        {
          options: [
            { optionId: fx.color.id, valueIds: [fx.color.values.red, fx.color.values.blue] },
          ],
        },
      );
      expect(withOptions.status, JSON.stringify(withOptions.body)).toBe(200);
      const [, second] = withOptions.body.variants;
      expect(second, "the product has two variants").toBeDefined();
      await priceProductVariants(pool, created.id);
      expect((await call("POST", `/admin/products/${created.id}/publish`)).status).toBe(200);
      // The default variant can not be deleted at all, so take the other one.
      const target = second?.id ?? "";
      expect(
        (
          await call("PATCH", `/admin/products/${created.id}/variants/${target}`, {
            allowBackorder: true,
          })
        ).status,
      ).toBe(200);

      const held = await holdOpen(database, (tx) =>
        service.reserveMany(tx, [{ variantId: target, quantity: 1 }], {
          expiresAt: future(),
          reference: "ORD-DEL",
        }),
      );
      expect(held.result.ok).toBe(true);
      const unpublish = call("POST", `/admin/products/${created.id}/unpublish`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await held.release();
      expect((await unpublish).status).toBe(200);
      const deletion = await call("DELETE", `/admin/products/${created.id}/variants/${target}`);
      expect(deletion.status, JSON.stringify(deletion.body)).toBe(409);
      expect(deletion.body).toMatchObject({ rule: "has_stock_history" });
      expect(await reservationsOf(pool, target)).toHaveLength(1);
    });

    it("an option change cannot slip in between an order and the unpublish it needs (ADR 0014)", async () => {
      const entry = await world.variant({ allowBackorder: true });
      const held = await holdOpen(database, (tx) =>
        service.reserveMany(tx, [{ variantId: entry.variantId, quantity: 1 }], {
          expiresAt: future(),
          reference: "ORD-OPT",
        }),
      );
      const unpublish = call("POST", `/admin/products/${entry.productId}/unpublish`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await held.release();
      expect((await unpublish).status).toBe(200);
      const color: OptionFixture = fx.color;
      const red = color.values.red;
      const change = await call("PUT", `/admin/products/${entry.productId}/options`, {
        options: [{ optionId: color.id, valueIds: [red] }],
      });
      expect(change.status, JSON.stringify(change.body)).toBe(409);
      expect(change.body).toMatchObject({ rule: "has_stock_history" });
    });
  });

  describe("row locks", () => {
    it("makes reserveMany wait for the product row, the variant row and the level row", async () => {
      const entry = await world.variant({ onHand: 5 });
      const lines = [{ variantId: entry.variantId, quantity: 1 }];
      const afterProduct = await expectWaitsForLock(
        pool,
        (client) => lockRow(client, "product", entry.productId),
        () => reserveMany(lines),
        "reserveMany (product row)",
      );
      expect(afterProduct.ok).toBe(true);
      const afterVariant = await expectWaitsForLock(
        pool,
        (client) => lockRow(client, "variant", entry.variantId),
        () => reserveMany(lines),
        "reserveMany (variant row)",
      );
      expect(afterVariant.ok).toBe(true);
      const afterLevel = await expectWaitsForLock(
        pool,
        async (client) => {
          const locked = await client.query(
            "select 1 from inventory_level where variant_id = $1 and location_id = $2 for no key update",
            [entry.variantId, mainId],
          );
          expect(locked.rowCount).toBe(1);
        },
        () => reserveMany(lines),
        "reserveMany (level row)",
      );
      expect(afterLevel.ok).toBe(true);
      expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 5, reserved: 3 });
    });

    it("takes the product, variant and level locks of an order in id order, whatever the order of its lines", async () => {
      const first = await world.variant({ onHand: 5 });
      const second = await world.variant({ onHand: 5 });
      const probe = async (sql: string, params: unknown[]) => {
        // The order must already hold this row (shared or exclusive), so a NOWAIT lock request is refused.
        await expect(pool.query(sql, params)).rejects.toMatchObject({ code: "55P03" });
      };
      const byVariant = [first, second].sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
      const byProduct = [first, second].sort((a, b) => (a.productId < b.productId ? -1 : 1));
      const [lowVariant, highVariant] = [byVariant[0], byVariant[1]];
      const [lowProduct, highProduct] = [byProduct[0], byProduct[1]];
      if (!lowVariant || !highVariant || !lowProduct || !highProduct) {
        throw new Error("two variants expected");
      }
      const linesFor = (high: { variantId: string }, low: { variantId: string }) => [
        { variantId: high.variantId, quantity: 1 },
        { variantId: low.variantId, quantity: 1 },
      ];

      // Blocked at the higher product: the lower product row must already be locked.
      const afterProducts = await expectWaitsForLock(
        pool,
        (client) => lockRow(client, "product", highProduct.productId),
        () => reserveMany(linesFor(highProduct, lowProduct)),
        "reserveMany (higher product)",
        () =>
          probe("select 1 from product where id = $1 for no key update nowait", [
            lowProduct.productId,
          ]),
      );
      expect(afterProducts.ok).toBe(true);

      // Blocked at the higher variant: the lower variant row must already be locked.
      const afterVariants = await expectWaitsForLock(
        pool,
        (client) => lockRow(client, "variant", highVariant.variantId),
        () => reserveMany(linesFor(highVariant, lowVariant)),
        "reserveMany (higher variant)",
        () =>
          probe("select 1 from variant where id = $1 for no key update nowait", [
            lowVariant.variantId,
          ]),
      );
      expect(afterVariants.ok).toBe(true);

      // Blocked at the higher level: the lower level row must already be locked.
      const afterLevels = await expectWaitsForLock(
        pool,
        async (client) => {
          const locked = await client.query(
            "select 1 from inventory_level where variant_id = $1 for no key update",
            [highVariant.variantId],
          );
          expect(locked.rowCount).toBe(1);
        },
        () => reserveMany(linesFor(highVariant, lowVariant)),
        "reserveMany (higher level)",
        () =>
          probe("select 1 from inventory_level where variant_id = $1 for no key update nowait", [
            lowVariant.variantId,
          ]),
      );
      expect(afterLevels.ok).toBe(true);
    });

    it("makes releaseIn, commitIn and extend wait for the level row", async () => {
      const entry = await world.variant({ onHand: 10 });
      const toRelease = await reservedLine(
        await reserveMany([{ variantId: entry.variantId, quantity: 1 }]),
        0,
      );
      const toCommit = await reservedLine(
        await reserveMany([{ variantId: entry.variantId, quantity: 1 }]),
        0,
      );
      const toExtend = await reservedLine(
        await reserveMany([{ variantId: entry.variantId, quantity: 1 }]),
        0,
      );
      const holdLevel = async (client: pg.PoolClient) => {
        const locked = await client.query(
          "select 1 from inventory_level where variant_id = $1 and location_id = $2 for no key update",
          [entry.variantId, mainId],
        );
        expect(locked.rowCount).toBe(1);
      };
      const released = await expectWaitsForLock(
        pool,
        holdLevel,
        () => inTransaction(database, (tx) => service.releaseIn(tx, toRelease.id)),
        "releaseIn",
      );
      expect(released.ok).toBe(true);
      const committed = await expectWaitsForLock(
        pool,
        holdLevel,
        () => inTransaction(database, (tx) => service.commitIn(tx, toCommit.id, {})),
        "commitIn",
      );
      expect(committed.ok).toBe(true);
      const extended = await expectWaitsForLock(
        pool,
        holdLevel,
        () =>
          inTransaction(database, (tx) =>
            service.extend(tx, toExtend.id, new Date(toExtend.expiresAt.getTime() + HOUR)),
          ),
        "extend",
      );
      expect(extended.ok).toBe(true);
      await expectLevelInvariants(pool, entry.variantId, mainId);
    });
  });

  describe("one reservation, several actors", () => {
    it("lets exactly one of commitIn, releaseIn and expireDue settle an overdue reservation (10 rounds)", async () => {
      for (let round = 0; round < 10; round += 1) {
        const entry = await world.variant({ onHand: 4 });
        const held = await reservedLine(
          await reserveMany([{ variantId: entry.variantId, quantity: 3 }], "ORD-RACE", past()),
          0,
        );
        const [committed, released, swept] = await allFulfilled([
          inTransaction(database, (tx) => service.commitIn(tx, held.id, { actorId })),
          inTransaction(database, (tx) => service.releaseIn(tx, held.id)),
          service.expireDue(new Date()),
        ]);
        expect(swept.failures).toEqual([]);
        const [row] = await reservationsOf(pool, entry.variantId);
        const winners = [committed.ok, released.ok, row?.status === "expired"].filter(Boolean);
        expect(winners, `round ${round}: ${row?.status}`).toHaveLength(1);
        if (committed.ok) {
          expect(row?.status).toBe("committed");
          expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 1, reserved: 0 });
        } else {
          expect(committed).toMatchObject({ ok: false });
          expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 4, reserved: 0 });
        }
        if (released.ok) {
          expect(row?.status).toBe("released");
        } else {
          expect(released).toMatchObject({ ok: false });
        }
        await expectLevelInvariants(pool, entry.variantId, mainId);
        const movements = await movementsOf(pool, entry.variantId);
        expectJournalReplays(movements, committed.ok ? 1 : 4);
        expect(movements.filter((movement) => movement.kind === "sale")).toHaveLength(
          committed.ok ? 1 : 0,
        );
      }
    });

    it("lets extend win before the sweep and refuses an extend after it (deterministic order)", async () => {
      const early = await world.variant({ onHand: 4 });
      const heldEarly = await reservedLine(
        await reserveMany([{ variantId: early.variantId, quantity: 2 }], "ORD-X", past()),
        0,
      );
      const hold = await holdOpen(database, (tx) =>
        service.extend(tx, heldEarly.id, new Date(Date.now() + 2 * HOUR)),
      );
      expect(hold.result.ok).toBe(true);
      // The sweep starts while the extend is uncommitted: it must wait, then find the reservation not due any more.
      const sweep = service.expireDue(new Date());
      await new Promise((resolve) => setTimeout(resolve, 300));
      await hold.release();
      const swept = await sweep;
      expect(swept.failures).toEqual([]);
      expect((await reservationsOf(pool, early.variantId))[0]?.status).toBe("active");
      expect(await levelOf(pool, early.variantId, mainId)).toEqual({ on_hand: 4, reserved: 2 });

      const late = await world.variant({ onHand: 4 });
      const heldLate = await reservedLine(
        await reserveMany([{ variantId: late.variantId, quantity: 2 }], "ORD-Y", past()),
        0,
      );
      await service.expireDue(new Date());
      const refused = await inTransaction(database, (tx) =>
        service.extend(tx, heldLate.id, new Date(Date.now() + 2 * HOUR)),
      );
      expect(refused).toEqual({ ok: false, reason: "not_active" });
      expect((await reservationsOf(pool, late.variantId))[0]?.status).toBe("expired");
      expect(await levelOf(pool, late.variantId, mainId)).toEqual({ on_hand: 4, reserved: 0 });
    });

    it("settles extend against a parallel sweep consistently (12 rounds)", async () => {
      for (let round = 0; round < 12; round += 1) {
        const entry = await world.variant({ onHand: 4 });
        const held = await reservedLine(
          await reserveMany([{ variantId: entry.variantId, quantity: 2 }], "ORD-Z", past()),
          0,
        );
        const [extended, swept] = await allFulfilled([
          inTransaction(database, (tx) =>
            service.extend(tx, held.id, new Date(Date.now() + 2 * HOUR)),
          ),
          service.expireDue(new Date()),
        ]);
        expect(swept.failures).toEqual([]);
        const [row] = await reservationsOf(pool, entry.variantId);
        if (extended.ok) {
          expect(row?.status, `round ${round}`).toBe("active");
          expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 4, reserved: 2 });
        } else {
          expect(extended).toEqual({ ok: false, reason: "not_active" });
          expect(row?.status).toBe("expired");
          expect(await levelOf(pool, entry.variantId, mainId)).toEqual({ on_hand: 4, reserved: 0 });
        }
        await expectLevelInvariants(pool, entry.variantId, mainId);
      }
    });
  });

  describe("whole order lifecycle", () => {
    it("keeps every invariant and a replayable journal when 12 two-line orders place, pay or cancel in parallel", async () => {
      const a = await world.variant({ onHand: 8 });
      const b = await world.variant({ onHand: 8 });
      const lifecycle = async (index: number) => {
        const lines = (index % 2 === 0 ? [a, b] : [b, a]).map((entry) => ({
          variantId: entry.variantId,
          quantity: 1,
        }));
        const placed = await reserveMany(lines, `ORD-LC-${index}`);
        if (!placed.ok) {
          return "refused" as const;
        }
        // The contract for order transitions: handle an order's reservations sorted by (variant id, location id), so
        // two orders with crossing lines lock the level rows in the same order.
        const ids = placed.lines
          .flatMap((line) => (line.kind === "reserved" ? [line.reservation] : []))
          .sort((x, y) => (x.variantId < y.variantId ? -1 : x.variantId > y.variantId ? 1 : 0))
          .map((reservation) => reservation.id);
        const pay = index % 3 !== 0;
        await inTransaction(database, async (tx) => {
          for (const id of ids) {
            const result = pay
              ? await service.commitIn(tx, id, { actorId: null })
              : await service.releaseIn(tx, id);
            expect(result.ok).toBe(true);
          }
        });
        return pay ? ("paid" as const) : ("cancelled" as const);
      };
      const outcomes = await allFulfilled(
        Array.from({ length: 12 }, (_, index) => lifecycle(index)),
      );
      const paid = outcomes.filter((outcome) => outcome === "paid").length;
      for (const entry of [a, b]) {
        const level = await expectLevelInvariants(pool, entry.variantId, mainId);
        expect(level.onHand).toBe(8 - paid);
        expect(level.reserved).toBe(0);
        expectJournalReplays(await movementsOf(pool, entry.variantId), 8 - paid);
        const sales = (await movementsOf(pool, entry.variantId)).filter(
          (movement) => movement.kind === "sale",
        );
        expect(sales).toHaveLength(paid);
        expect(sales.every((movement) => movement.actor_id === null)).toBe(true);
      }
    });
  });
});

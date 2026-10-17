import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { findPostgresError } from "../../common/postgres-errors.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { caller, createCatalogFixture, type CatalogFixture } from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import {
  defaultLocationId,
  insertAdminUserRow,
  levelOf,
  movementsOf,
  ownerAuthenticator,
} from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { inTransaction } from "../../test/reservation-tx.js";
import { expectLevelInvariants, reservationsOf, StockWorld } from "../../test/stock-world.js";
import { InventoryRepository } from "../inventory.repository.js";
import { ReservationsService } from "./reservations.service.js";

const HOUR = 3_600_000;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

/**
 * The sorted batch operations of one order's reservations (`releaseManyIn`, `commitManyIn`, `extendManyIn`): the 5a
 * finding is that two orders with crossing lines deadlock (40P01) when each handles its reservations in its own order.
 * Each call below takes the level locks in (variant id, location id) order, whatever order the ids are given in.
 */
describe("ReservationsService batch operations on one order's reservations (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let fx: CatalogFixture;
  let world: StockWorld;
  let service: ReservationsService;
  let inventory: InventoryRepository;
  let database: Database;
  let mainId = "";
  let actorId = "";

  const future = () => new Date(Date.now() + HOUR);

  async function hold(variantId: string, quantity: number): Promise<string> {
    const result = await service.reserve({
      variantId,
      quantity,
      expiresAt: future(),
      reference: "7K3M-9QX2",
    });
    if (!result.ok) {
      throw new Error(`reserve refused: ${result.reason}`);
    }
    return result.reservation.id;
  }

  beforeAll(async () => {
    await ensureMigrated();
    actorId = await insertAdminUserRow(pool);
    running = await startApp({ adminAuthenticator: ownerAuthenticator(actorId) });
    const call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    service = running.app.get(ReservationsService, { strict: false });
    inventory = running.app.get(InventoryRepository, { strict: false });
    database = running.app.get<Database>(DRIZZLE, { strict: false });
    mainId = await defaultLocationId(pool);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.query("delete from admin_user where id = $1", [actorId]);
    await pool.end();
  });

  async function threeHeld() {
    const variants = [
      await world.variant({ onHand: 10 }),
      await world.variant({ onHand: 10 }),
      await world.variant({ onHand: 10 }),
    ].sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
    const [first, second, third] = variants;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("Test setup bug");
    }
    const reservationIds = [
      await hold(first.variantId, 1),
      await hold(second.variantId, 2),
      await hold(third.variantId, 3),
    ];
    return { variants, reservationIds };
  }

  describe("lock order", () => {
    it("takes the level locks in variant id order although the ids come in reverse order", async () => {
      const { variants, reservationIds } = await threeHeld();
      const spy = vi.spyOn(inventory, "lockLevel");
      await inTransaction(database, (tx) =>
        service.releaseManyIn(tx, [...reservationIds].reverse()),
      );
      expect(spy.mock.calls.map((call) => call[1])).toEqual(variants.map((v) => v.variantId));
    });

    it("commit and extend sort the same way", async () => {
      const { variants, reservationIds } = await threeHeld();
      const spy = vi.spyOn(inventory, "lockLevel");
      await inTransaction(database, (tx) =>
        service.commitManyIn(tx, [...reservationIds].reverse(), { reference: "7K3M-9QX2" }),
      );
      expect(spy.mock.calls.map((call) => call[1])).toEqual(variants.map((v) => v.variantId));

      const more = await threeHeld();
      spy.mockClear();
      await inTransaction(database, (tx) =>
        service.extendManyIn(
          tx,
          [...more.reservationIds].reverse(),
          new Date(Date.now() + 2 * HOUR),
        ),
      );
      expect(spy.mock.calls.map((call) => call[1])).toEqual(more.variants.map((v) => v.variantId));
    });
  });

  describe("releaseManyIn", () => {
    it("releases every reservation, gives the units back and answers in the sorted order", async () => {
      const { variants, reservationIds } = await threeHeld();
      const results = await inTransaction(database, (tx) =>
        service.releaseManyIn(tx, [...reservationIds].reverse()),
      );
      expect(results.map((entry) => entry.reservationId)).toEqual(reservationIds);
      for (const entry of results) {
        expect(entry.result.ok, entry.reservationId).toBe(true);
      }
      for (const variant of variants) {
        expect(await levelOf(pool, variant.variantId, mainId)).toMatchObject({ reserved: 0 });
        await expectLevelInvariants(pool, variant.variantId, mainId);
        expect((await reservationsOf(pool, variant.variantId))[0]?.status).toBe("released");
      }
    });

    it("answers per reservation: one that is not active is reported and the others are still released", async () => {
      const { variants, reservationIds } = await threeHeld();
      const [first, second, third] = reservationIds;
      await service.release(second ?? "");
      const results = await inTransaction(database, (tx) =>
        service.releaseManyIn(tx, [third ?? "", first ?? "", second ?? ""]),
      );
      expect(results.map((entry) => entry.result.ok)).toEqual([true, false, true]);
      expect(results[1]?.result).toEqual({ ok: false, reason: "not_active" });
      for (const variant of variants) {
        expect(await levelOf(pool, variant.variantId, mainId)).toMatchObject({ reserved: 0 });
      }
    });

    it("lists an unknown id as reservation_not_found after the known ones", async () => {
      const { reservationIds } = await threeHeld();
      const results = await inTransaction(database, (tx) =>
        service.releaseManyIn(tx, [MISSING_ID, ...reservationIds]),
      );
      expect(results.map((entry) => entry.reservationId)).toEqual([...reservationIds, MISSING_ID]);
      expect(results.at(-1)?.result).toEqual({ ok: false, reason: "reservation_not_found" });
      expect(results.slice(0, -1).every((entry) => entry.result.ok)).toBe(true);
    });

    it("throws RangeError for a duplicate id, without touching anything", async () => {
      const { variants, reservationIds } = await threeHeld();
      const [first] = reservationIds;
      await expect(
        inTransaction(database, (tx) => service.releaseManyIn(tx, [first ?? "", first ?? ""])),
      ).rejects.toThrow(RangeError);
      expect(await levelOf(pool, variants[0]?.variantId ?? "", mainId)).toMatchObject({
        reserved: 1,
      });
    });

    it("an empty list is a no-op", async () => {
      expect(await inTransaction(database, (tx) => service.releaseManyIn(tx, []))).toEqual([]);
    });
  });

  describe("commitManyIn", () => {
    it("sells every reservation: sale movements with the reference and the actor, levels lowered", async () => {
      const { variants, reservationIds } = await threeHeld();
      const results = await inTransaction(database, (tx) =>
        service.commitManyIn(tx, [...reservationIds].reverse(), {
          actorId,
          reference: "7K3M-9QX2",
        }),
      );
      expect(results.map((entry) => entry.reservationId)).toEqual(reservationIds);
      expect(results.every((entry) => entry.result.ok)).toBe(true);
      for (const [index, variant] of variants.entries()) {
        expect(await levelOf(pool, variant.variantId, mainId)).toMatchObject({
          on_hand: 10 - (index + 1),
          reserved: 0,
        });
        const sales = (await movementsOf(pool, variant.variantId)).filter(
          (movement) => movement.kind === "sale",
        );
        expect(sales).toHaveLength(1);
        expect(sales[0]).toMatchObject({
          delta: -(index + 1),
          reference: "7K3M-9QX2",
          actor_id: actorId,
        });
      }
    });

    it("reports a backordered reservation as insufficient_stock and still sells the others", async () => {
      const stocked = await world.variant({ onHand: 5 });
      const backordered = await world.variant({ onHand: 1, allowBackorder: true });
      const a = await hold(stocked.variantId, 2);
      const b = await hold(backordered.variantId, 3);
      const results = await inTransaction(database, (tx) =>
        service.commitManyIn(tx, [a, b], { reference: "7K3M-9QX2" }),
      );
      const byId = new Map(results.map((entry) => [entry.reservationId, entry.result]));
      expect(byId.get(a)).toMatchObject({ ok: true });
      expect(byId.get(b)).toEqual({ ok: false, reason: "insufficient_stock" });
      expect(await levelOf(pool, backordered.variantId, mainId)).toMatchObject({
        on_hand: 1,
        reserved: 3,
      });
      expect((await reservationsOf(pool, backordered.variantId))[0]?.status).toBe("active");
    });
  });

  describe("extendManyIn", () => {
    it("moves every active reservation later and reports the refusal of one that is not active", async () => {
      const { variants, reservationIds } = await threeHeld();
      await service.release(reservationIds[1] ?? "");
      const later = new Date(Date.now() + 5 * HOUR);
      const results = await inTransaction(database, (tx) =>
        service.extendManyIn(tx, [...reservationIds].reverse(), later),
      );
      expect(results.map((entry) => entry.result.ok)).toEqual([true, false, true]);
      expect(results[1]?.result).toEqual({ ok: false, reason: "not_active" });
      const first = (await reservationsOf(pool, variants[0]?.variantId ?? ""))[0];
      expect(first?.expires_at.getTime()).toBe(later.getTime());
    });
  });

  describe("two orders with crossing lines", () => {
    it("never deadlock when each handles its reservations through the batch helper (many rounds)", async () => {
      const a = await world.variant({ onHand: 1000 });
      const b = await world.variant({ onHand: 1000 });
      const failures: unknown[] = [];
      for (let round = 0; round < 25; round += 1) {
        const orderOne = [await hold(a.variantId, 1), await hold(b.variantId, 1)];
        const orderTwo = [await hold(b.variantId, 1), await hold(a.variantId, 1)];
        const settled = await Promise.allSettled([
          inTransaction(database, (tx) => service.releaseManyIn(tx, orderOne)),
          inTransaction(database, (tx) => service.releaseManyIn(tx, orderTwo)),
        ]);
        for (const outcome of settled) {
          if (outcome.status === "rejected") {
            failures.push(findPostgresError(outcome.reason)?.code ?? outcome.reason);
          }
        }
      }
      expect(failures).toEqual([]);
      await expectLevelInvariants(pool, a.variantId, mainId);
      await expectLevelInvariants(pool, b.variantId, mainId);
      expect(await levelOf(pool, a.variantId, mainId)).toMatchObject({ reserved: 0 });
    });
  });
});

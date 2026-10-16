import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { caller, createCatalogFixture, type CatalogFixture } from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import {
  defaultLocationId,
  expectJournalReplays,
  expectWaitsForLevelLock,
  insertAdminUserRow,
  levelCount,
  levelOf,
  movementsOf,
  ownerAuthenticator,
} from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { expectLevelInvariants, reservationsOf, StockWorld } from "../../test/stock-world.js";
import { ReservationsService } from "./reservations.service.js";

const HOUR = 3_600_000;

/** Real parallel transactions on one Postgres: the row lock, not the test, decides who wins. */
describe("ReservationsService under concurrency (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let fx: CatalogFixture;
  let world: StockWorld;
  let service: ReservationsService;
  let mainId = "";
  let actorId = "";
  let call: ReturnType<typeof caller>;

  const future = () => new Date(Date.now() + HOUR);
  const past = () => new Date(Date.now() - HOUR);

  async function reserveOk(variantId: string, quantity: number, expiresAt = future()) {
    const result = await service.reserve({ variantId, quantity, expiresAt });
    if (!result.ok) {
      throw new Error(`reserve refused: ${result.reason}`);
    }
    return result.reservation;
  }

  beforeAll(async () => {
    await ensureMigrated();
    actorId = await insertAdminUserRow(pool);
    running = await startApp({ adminAuthenticator: ownerAuthenticator(actorId) });
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    service = running.app.get(ReservationsService, { strict: false });
    mainId = await defaultLocationId(pool);
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.query("delete from admin_user where id = $1", [actorId]);
    await pool.end();
  });

  it("lets exactly one of 10 parallel reservations take the last unit", async () => {
    for (let round = 0; round < 3; round += 1) {
      const { variantId } = await world.variant({ onHand: 1 });
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          service.reserve({ variantId, quantity: 1, expiresAt: future() }),
        ),
      );
      expect(
        results.filter((result) => result.ok),
        `round ${round}`,
      ).toHaveLength(1);
      const refused = results.filter((result) => !result.ok);
      expect(refused).toHaveLength(9);
      for (const result of refused) {
        expect(result).toEqual({ ok: false, reason: "insufficient_stock" });
      }
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 1, reserved: 1 });
      expect(await reservationsOf(pool, variantId)).toHaveLength(1);
      await expectLevelInvariants(pool, variantId, mainId);
    }
  });

  it("never reserves more than is on hand: 12 parallel reservations of 2 from 5 units win exactly twice", async () => {
    const { variantId } = await world.variant({ onHand: 5 });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        service.reserve({ variantId, quantity: 2, expiresAt: future() }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 4 });
    await expectLevelInvariants(pool, variantId, mainId);
  });

  it("serializes parallel first reservations of a backorder variant without a level row into one row", async () => {
    const { variantId } = await world.variant({ allowBackorder: true });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.reserve({ variantId, quantity: 3, expiresAt: future() }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await levelCount(pool, variantId)).toBe(1);
    expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 30 });
    await expectLevelInvariants(pool, variantId, mainId, { allowBackorder: true });
  });

  it("lets only one of two parallel commits of one reservation sell", async () => {
    for (let round = 0; round < 4; round += 1) {
      const { variantId } = await world.variant({ onHand: 5 });
      const held = await reserveOk(variantId, 2);
      const results = await Promise.all([
        service.commit(held.id, { actorId }),
        service.commit(held.id, { actorId }),
        service.commit(held.id, { actorId }),
      ]);
      expect(
        results.filter((result) => result.ok),
        `round ${round}`,
      ).toHaveLength(1);
      for (const result of results.filter((entry) => !entry.ok)) {
        expect(result).toEqual({ ok: false, reason: "already_committed" });
      }
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 3, reserved: 0 });
      const sales = (await movementsOf(pool, variantId)).filter((row) => row.kind === "sale");
      expect(sales).toHaveLength(1);
    }
  });

  it("settles commit against release of the same reservation: one wins, the level stays consistent", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { variantId } = await world.variant({ onHand: 4 });
      const held = await reserveOk(variantId, 3);
      const [committed, released] = await Promise.all([
        service.commit(held.id, { actorId }),
        service.release(held.id),
      ]);
      expect([committed.ok, released.ok].filter(Boolean), `round ${round}`).toHaveLength(1);
      const [row] = await reservationsOf(pool, variantId);
      if (committed.ok) {
        expect(row?.status).toBe("committed");
        expect(released).toMatchObject({ ok: false, reason: "already_committed" });
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 1, reserved: 0 });
      } else {
        expect(row?.status).toBe("released");
        expect(committed).toMatchObject({ ok: false, reason: "not_active" });
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 4, reserved: 0 });
      }
      await expectLevelInvariants(pool, variantId, mainId);
    }
  });

  it("settles commit against expireDue of an overdue reservation the same way", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { variantId } = await world.variant({ onHand: 4 });
      const held = await reserveOk(variantId, 3, past());
      const [committed, swept] = await Promise.all([
        service.commit(held.id, { actorId }),
        service.expireDue(new Date()),
      ]);
      const [row] = await reservationsOf(pool, variantId);
      // expireDue also sweeps overdue reservations of other specs' variants, so look at this one only.
      if (committed.ok) {
        expect(row?.status, `round ${round}`).toBe("committed");
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 1, reserved: 0 });
      } else {
        expect(committed).toMatchObject({ ok: false, reason: "not_active" });
        expect(row?.status).toBe("expired");
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 4, reserved: 0 });
      }
      expect(swept.failures).toEqual([]);
      await expectLevelInvariants(pool, variantId, mainId);
    }
  });

  it("keeps every invariant when reserve, commit, release and expireDue interleave (6 rounds)", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { variantId } = await world.variant({ onHand: 10 });
      const toCommit = [await reserveOk(variantId, 1), await reserveOk(variantId, 2)];
      const toRelease = [await reserveOk(variantId, 1), await reserveOk(variantId, 1)];
      const overdue = [
        await reserveOk(variantId, 1, past()),
        await reserveOk(variantId, 2, past()),
      ];
      const [reserves] = await Promise.all([
        Promise.all(
          Array.from({ length: 6 }, () =>
            service.reserve({ variantId, quantity: 1, expiresAt: future() }),
          ),
        ),
        Promise.all(toCommit.map((held) => service.commit(held.id, { actorId }))),
        Promise.all(toRelease.map((held) => service.release(held.id))),
        service.expireDue(new Date()),
        service.expireDue(new Date()),
      ]);
      // Nothing may fail unexpectedly: every reservation was active and distinct.
      for (const held of toCommit) {
        expect(
          (await reservationsOf(pool, variantId)).find((row) => row.id === held.id)?.status,
        ).toBe("committed");
      }
      for (const held of overdue) {
        expect(
          (await reservationsOf(pool, variantId)).find((row) => row.id === held.id)?.status,
        ).toBe("expired");
      }
      const level = await expectLevelInvariants(pool, variantId, mainId);
      const newlyReserved = reserves.filter((result) => result.ok).length;
      // 10 on hand - 3 sold = 7; held: 6 new reservations at most, limited by what was left (10 - 3 - ...).
      expect(level.onHand, `round ${round}`).toBe(7);
      expect(level.reserved).toBe(newlyReserved);
      expectJournalReplays(await movementsOf(pool, variantId), 7);
    }
  });

  it("keeps reserved at or below on hand when reservations race manual stock removals", async () => {
    const { productId, variantId } = await world.variant({ onHand: 6 });
    const path = `/admin/products/${productId}/variants/${variantId}/inventory/adjustments`;
    const [reserves, adjustments] = await Promise.all([
      Promise.all(
        Array.from({ length: 6 }, () =>
          service.reserve({ variantId, quantity: 1, expiresAt: future() }),
        ),
      ),
      Promise.all(
        Array.from({ length: 6 }, () => call("POST", path, { delta: -1, kind: "adjustment" })),
      ),
    ]);
    const level = await expectLevelInvariants(pool, variantId, mainId);
    const reserved = reserves.filter((result) => result.ok).length;
    const removed = adjustments.filter((result) => result.status === 201).length;
    expect(level.reserved).toBe(reserved);
    expect(level.onHand).toBe(6 - removed);
    expect(reserved + removed, "no unit is both held and removed").toBeLessThanOrEqual(6);
    expectJournalReplays(await movementsOf(pool, variantId), level.onHand);
  });

  describe("row lock", () => {
    it("makes reserve, release, commit and expireDue wait for the inventory_level row", async () => {
      const { variantId } = await world.variant({ onHand: 10 });
      const toRelease = await reserveOk(variantId, 1);
      const toCommit = await reserveOk(variantId, 1);
      const toExpire = await reserveOk(variantId, 1, past());

      await expectWaitsForLevelLock(
        pool,
        variantId,
        mainId,
        () => service.reserve({ variantId, quantity: 1, expiresAt: future() }),
        (result) => expect(result.ok).toBe(true),
      );
      await expectWaitsForLevelLock(
        pool,
        variantId,
        mainId,
        () => service.release(toRelease.id),
        (result) => expect(result.ok).toBe(true),
      );
      await expectWaitsForLevelLock(
        pool,
        variantId,
        mainId,
        () => service.commit(toCommit.id, { actorId }),
        (result) => expect(result.ok).toBe(true),
      );
      await expectWaitsForLevelLock(
        pool,
        variantId,
        mainId,
        () => service.expireDue(new Date()),
        (result) => expect(result.expired).toBeGreaterThanOrEqual(1),
      );
      expect(
        (await reservationsOf(pool, variantId)).find((row) => row.id === toExpire.id)?.status,
      ).toBe("expired");
      await expectLevelInvariants(pool, variantId, mainId);
    });
  });
});

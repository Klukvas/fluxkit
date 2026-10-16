import { MAX_QUANTITY, MAX_RESERVED } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { caller, createCatalogFixture, type CatalogFixture } from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import {
  defaultLocationId,
  expectJournalReplays,
  insertAdminUserRow,
  insertLocation,
  levelCount,
  levelOf,
  movementsOf,
  ownerAuthenticator,
} from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { expectLevelInvariants, reservationsOf, StockWorld } from "../../test/stock-world.js";
import { ReservationsService } from "./reservations.service.js";

const HOUR = 3_600_000;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("ReservationsService (real Postgres, no HTTP route)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let fx: CatalogFixture;
  let world: StockWorld;
  let service: ReservationsService;
  let mainId = "";
  let actorId = "";
  let northId = "";

  const future = () => new Date(Date.now() + HOUR);

  async function reserveOk(variantId: string, quantity: number, extra: object = {}) {
    const result = await service.reserve({ variantId, quantity, expiresAt: future(), ...extra });
    if (!result.ok) {
      throw new Error(`reserve refused: ${result.reason}`);
    }
    return result.reservation;
  }

  beforeAll(async () => {
    await ensureMigrated();
    actorId = await insertAdminUserRow(pool);
    running = await startApp({ adminAuthenticator: ownerAuthenticator(actorId) });
    const call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
    service = running.app.get(ReservationsService, { strict: false });
    mainId = await defaultLocationId(pool);
    northId = await insertLocation(pool, `res_${fx.runId}`);
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.query("delete from location where id = $1", [northId]);
    await pool.query("delete from admin_user where id = $1", [actorId]);
    await pool.end();
  });

  describe("reserve", () => {
    it("holds the units: reserved goes up, on hand stays, a reservation row is written, no journal row", async () => {
      const { variantId } = await world.variant({ onHand: 10 });
      const expiresAt = future();
      const result = await service.reserve({
        variantId,
        quantity: 4,
        expiresAt,
        reference: "cart-1",
      });
      expect(result).toEqual({
        ok: true,
        reservation: {
          id: expect.any(String),
          variantId,
          locationId: mainId,
          quantity: 4,
          status: "active",
          expiresAt,
          reference: "cart-1",
        },
      });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 10, reserved: 4 });
      expect(await reservationsOf(pool, variantId)).toEqual([
        expect.objectContaining({ status: "active", quantity: 4, reference: "cart-1" }),
      ]);
      expect(await movementsOf(pool, variantId)).toHaveLength(1);
    });

    it("lets the last units go to the exact available quantity and then refuses", async () => {
      const { variantId } = await world.variant({ onHand: 3 });
      await reserveOk(variantId, 2);
      await reserveOk(variantId, 1);
      expect(await service.reserve({ variantId, quantity: 1, expiresAt: future() })).toEqual({
        ok: false,
        reason: "insufficient_stock",
      });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 3, reserved: 3 });
      expect(await reservationsOf(pool, variantId)).toHaveLength(2);
    });

    it("reserves at an explicit location", async () => {
      const { productId, variantId } = await world.variant();
      await world.receive({ productId, variantId }, 5);
      const target = await pool.query(
        "insert into inventory_level (variant_id, location_id, on_hand) values ($1, $2, 2) returning on_hand",
        [variantId, northId],
      );
      expect(target.rowCount).toBe(1);
      const held = await reserveOk(variantId, 2, { locationId: northId });
      expect(held.locationId).toBe(northId);
      expect(await levelOf(pool, variantId, northId)).toEqual({ on_hand: 2, reserved: 2 });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 0 });
    });

    it("refuses a variant that is not tracked with not_tracked and writes nothing", async () => {
      const { variantId } = await world.variant({ trackInventory: false });
      expect(await service.reserve({ variantId, quantity: 1, expiresAt: future() })).toEqual({
        ok: false,
        reason: "not_tracked",
      });
      expect(await levelCount(pool, variantId)).toBe(0);
      expect(await reservationsOf(pool, variantId)).toHaveLength(0);
    });

    it.each([0, -1, 1.5, Number.NaN, MAX_QUANTITY + 1])(
      "refuses the quantity %s with invalid_quantity and writes nothing",
      async (quantity) => {
        const { variantId } = await world.variant({ onHand: 5 });
        expect(await service.reserve({ variantId, quantity, expiresAt: future() })).toEqual({
          ok: false,
          reason: "invalid_quantity",
        });
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 0 });
        expect(await reservationsOf(pool, variantId)).toHaveLength(0);
      },
    );

    it("creates no level row when a variant without stock is refused", async () => {
      const { variantId } = await world.variant();
      expect(await service.reserve({ variantId, quantity: 1, expiresAt: future() })).toEqual({
        ok: false,
        reason: "insufficient_stock",
      });
      expect(await levelCount(pool, variantId)).toBe(0);
    });

    it("refuses a variant that is not sellable with variant_not_sellable and writes nothing", async () => {
      const draft = await world.variant({ onHand: 5, publish: false });
      const archived = await world.variant({ onHand: 5 });
      const unpublished = await world.variant({ onHand: 5 });
      const inactive = await world.variant({ onHand: 5 });
      const call = caller(() => running.baseUrl);
      expect((await call("POST", `/admin/products/${archived.productId}/archive`)).status).toBe(
        200,
      );
      expect(
        (await call("POST", `/admin/products/${unpublished.productId}/unpublish`)).status,
      ).toBe(200);
      await pool.query("update variant set is_active = false where id = $1", [inactive.variantId]);

      for (const { variantId } of [draft, archived, unpublished, inactive]) {
        expect(await service.reserve({ variantId, quantity: 1, expiresAt: future() })).toEqual({
          ok: false,
          reason: "variant_not_sellable",
        });
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 0 });
        expect(await reservationsOf(pool, variantId)).toHaveLength(0);
      }
    });

    it("refuses an unknown variant and an unknown location", async () => {
      expect(
        await service.reserve({ variantId: MISSING_ID, quantity: 1, expiresAt: future() }),
      ).toEqual({
        ok: false,
        reason: "variant_not_found",
      });
      const { variantId } = await world.variant({ onHand: 5 });
      expect(
        await service.reserve({
          variantId,
          locationId: MISSING_ID,
          quantity: 1,
          expiresAt: future(),
        }),
      ).toEqual({ ok: false, reason: "location_not_found" });
    });

    it("rejects an invalid expiry date loudly (a caller bug)", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      await expect(
        service.reserve({ variantId, quantity: 1, expiresAt: new Date(Number.NaN) }),
      ).rejects.toThrow(RangeError);
      expect(await reservationsOf(pool, variantId)).toHaveLength(0);
    });

    describe("with backorder allowed", () => {
      it("reserves beyond on hand, even without a level row, and creates the row for it", async () => {
        const { variantId } = await world.variant({ allowBackorder: true });
        expect(await levelCount(pool, variantId)).toBe(0);
        await reserveOk(variantId, 3);
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 3 });
        await reserveOk(variantId, 2);
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 5 });
        await expectLevelInvariants(pool, variantId, mainId, { allowBackorder: true });
      });

      it("refuses a reserved total above the stored limit and writes nothing (R5)", async () => {
        const { variantId } = await world.variant({ allowBackorder: true });
        await reserveOk(variantId, 1);
        await pool.query("update inventory_level set reserved = $2 where variant_id = $1", [
          variantId,
          MAX_RESERVED - 5,
        ]);
        expect(await service.reserve({ variantId, quantity: 10, expiresAt: future() })).toEqual({
          ok: false,
          reason: "reserved_out_of_range",
        });
        expect(await levelOf(pool, variantId, mainId)).toEqual({
          on_hand: 0,
          reserved: MAX_RESERVED - 5,
        });
        expect(await reservationsOf(pool, variantId)).toHaveLength(1);
        // A reservation that lands exactly on the bound still works.
        await reserveOk(variantId, 5);
        expect(await levelOf(pool, variantId, mainId)).toEqual({
          on_hand: 0,
          reserved: MAX_RESERVED,
        });
      });

      it("fulfils backorders in parts: reserve beyond stock, receive in parts, commit one by one (R1)", async () => {
        const { productId, variantId } = await world.variant({ allowBackorder: true, onHand: 1 });
        const first = await reserveOk(variantId, 4);
        const second = await reserveOk(variantId, 4);
        const third = await reserveOk(variantId, 2);
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 1, reserved: 10 });

        // A receipt smaller than the backorder is accepted; commits start as soon as one reservation is covered.
        await world.receive({ productId, variantId }, 2);
        expect(await service.commit(first.id, { actorId })).toEqual({
          ok: false,
          reason: "insufficient_stock",
        });
        await world.receive({ productId, variantId }, 1);
        expect((await service.commit(first.id, { actorId })).ok).toBe(true);
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 6 });
        expect(await service.commit(second.id, { actorId })).toEqual({
          ok: false,
          reason: "insufficient_stock",
        });
        await world.receive({ productId, variantId }, 6);
        expect((await service.commit(third.id, { actorId })).ok).toBe(true);
        expect((await service.commit(second.id, { actorId })).ok).toBe(true);
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 0 });
        await expectLevelInvariants(pool, variantId, mainId, { allowBackorder: true });
        const journal = await movementsOf(pool, variantId);
        expect(journal.map((row) => `${row.kind}:${row.delta}`)).toEqual([
          "receipt:1",
          "receipt:2",
          "receipt:1",
          "sale:-4",
          "receipt:6",
          "sale:-2",
          "sale:-4",
        ]);
        expectJournalReplays(journal, 0);
      });

      it("refuses to commit units that are not on hand and keeps the reservation active", async () => {
        const { productId, variantId } = await world.variant({ allowBackorder: true, onHand: 2 });
        const held = await reserveOk(variantId, 5);
        expect(await service.commit(held.id, { actorId })).toEqual({
          ok: false,
          reason: "insufficient_stock",
        });
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 2, reserved: 5 });
        expect((await reservationsOf(pool, variantId))[0]?.status).toBe("active");
        expect(await movementsOf(pool, variantId)).toHaveLength(1);

        await world.receive({ productId, variantId }, 3);
        const committed = await service.commit(held.id, { actorId });
        expect(committed.ok).toBe(true);
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 0, reserved: 0 });
      });
    });
  });

  describe("release", () => {
    it("gives the units back and marks the reservation released, without a journal row", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const held = await reserveOk(variantId, 3);
      const result = await service.release(held.id);
      expect(result).toEqual({ ok: true, reservation: { ...held, status: "released" } });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 0 });
      expect((await reservationsOf(pool, variantId))[0]?.status).toBe("released");
      expect(await movementsOf(pool, variantId)).toHaveLength(1);
    });

    it("refuses a second release, a committed reservation and an unknown id", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const first = await reserveOk(variantId, 1);
      const second = await reserveOk(variantId, 1);
      await service.release(first.id);
      expect(await service.release(first.id)).toEqual({ ok: false, reason: "not_active" });
      await service.commit(second.id, { actorId });
      expect(await service.release(second.id)).toEqual({ ok: false, reason: "already_committed" });
      expect(await service.release(MISSING_ID)).toEqual({
        ok: false,
        reason: "reservation_not_found",
      });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 4, reserved: 0 });
    });

    it("refuses with level_inconsistent when the level holds fewer reserved units than the reservation", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const held = await reserveOk(variantId, 3);
      await pool.query("update inventory_level set reserved = 1 where variant_id = $1", [
        variantId,
      ]);
      expect(await service.release(held.id)).toEqual({ ok: false, reason: "level_inconsistent" });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 1 });
      expect((await reservationsOf(pool, variantId))[0]?.status).toBe("active");
    });
  });

  describe("commit", () => {
    it("sells the units: on hand and reserved go down and a sale movement is journaled with the actor", async () => {
      const { variantId } = await world.variant({ onHand: 10 });
      const held = await reserveOk(variantId, 4, { reference: "cart-9" });
      const result = await service.commit(held.id, { actorId, reference: "order-1" });
      expect(result).toEqual({ ok: true, reservation: { ...held, status: "committed" } });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 6, reserved: 0 });
      const journal = await movementsOf(pool, variantId);
      expect(journal.at(-1)).toEqual({
        kind: "sale",
        delta: -4,
        on_hand_after: 6,
        reason: null,
        reference: "order-1",
        actor_id: actorId,
        location_id: mainId,
      });
      expectJournalReplays(journal, 6);
    });

    it("falls back to the reservation reference and to no actor", async () => {
      const { variantId } = await world.variant({ onHand: 3 });
      const held = await reserveOk(variantId, 1, { reference: "cart-7" });
      expect((await service.commit(held.id)).ok).toBe(true);
      expect((await movementsOf(pool, variantId)).at(-1)).toMatchObject({
        kind: "sale",
        reference: "cart-7",
        actor_id: null,
      });
    });

    it("refuses a second commit, a released or expired reservation and an unknown id", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const sold = await reserveOk(variantId, 1);
      const given = await reserveOk(variantId, 1);
      const late = await reserveOk(variantId, 1, { expiresAt: new Date(Date.now() - HOUR) });
      await service.commit(sold.id);
      await service.release(given.id);
      await service.expireDue(new Date());
      expect(await service.commit(sold.id)).toEqual({ ok: false, reason: "already_committed" });
      expect(await service.commit(given.id)).toEqual({ ok: false, reason: "not_active" });
      expect(await service.commit(late.id)).toEqual({ ok: false, reason: "not_active" });
      expect(await service.commit(MISSING_ID)).toEqual({
        ok: false,
        reason: "reservation_not_found",
      });
      expect(
        (await movementsOf(pool, variantId)).filter((row) => row.kind === "sale"),
      ).toHaveLength(1);
    });

    it("sells a reservation whose time passed but that nobody expired yet", async () => {
      const { variantId } = await world.variant({ onHand: 2 });
      const held = await reserveOk(variantId, 1, { expiresAt: new Date(Date.now() - HOUR) });
      expect((await service.commit(held.id)).ok).toBe(true);
    });
  });

  describe("expireDue", () => {
    it("expires only active reservations that are due at the given time, with the time as an argument", async () => {
      const { variantId } = await world.variant({ onHand: 20 });
      const now = new Date("2000-01-01T12:00:00.000Z");
      const due = await reserveOk(variantId, 2, {
        expiresAt: new Date("2000-01-01T11:00:00.000Z"),
      });
      const exactly = await reserveOk(variantId, 3, { expiresAt: now });
      const later = await reserveOk(variantId, 4, {
        expiresAt: new Date("2000-01-01T12:00:00.001Z"),
      });
      const released = await reserveOk(variantId, 1, {
        expiresAt: new Date("2000-01-01T10:00:00.000Z"),
      });
      await service.release(released.id);

      expect(await service.expireDue(now)).toEqual({
        scanned: 2,
        expired: 2,
        skipped: 0,
        failures: [],
      });
      const byId = new Map(
        (await reservationsOf(pool, variantId)).map((row) => [row.id, row.status]),
      );
      expect(byId.get(due.id)).toBe("expired");
      expect(byId.get(exactly.id)).toBe("expired");
      expect(byId.get(later.id)).toBe("active");
      expect(byId.get(released.id)).toBe("released");
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 20, reserved: 4 });
      expect(await movementsOf(pool, variantId)).toHaveLength(1);

      expect(await service.expireDue(now)).toMatchObject({ scanned: 0, expired: 0 });
      expect(await service.expireDue(new Date("2001-01-01T00:00:00.000Z"))).toMatchObject({
        expired: 1,
      });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 20, reserved: 0 });
    });

    it("works in batches: a limit bounds one call and a second call takes the rest", async () => {
      const { variantId } = await world.variant({ onHand: 20 });
      const past = new Date("1999-01-01T00:00:00.000Z");
      for (let index = 0; index < 5; index += 1) {
        await reserveOk(variantId, 1, { expiresAt: new Date(past.getTime() + index) });
      }
      const first = await service.expireDue(new Date("1999-12-31T00:00:00.000Z"), { limit: 3 });
      expect(first).toMatchObject({ scanned: 3, expired: 3 });
      const second = await service.expireDue(new Date("1999-12-31T00:00:00.000Z"), { limit: 3 });
      expect(second).toMatchObject({ scanned: 2, expired: 2 });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 20, reserved: 0 });
    });

    it("reports a reservation it cannot expire and still expires the others", async () => {
      const { variantId: broken } = await world.variant({ onHand: 5 });
      const { variantId: fine } = await world.variant({ onHand: 5 });
      const past = new Date("1998-01-01T00:00:00.000Z");
      const bad = await reserveOk(broken, 3, { expiresAt: past });
      await reserveOk(fine, 1, { expiresAt: past });
      await pool.query("update inventory_level set reserved = 0 where variant_id = $1", [broken]);
      const result = await service.expireDue(new Date("1998-06-01T00:00:00.000Z"));
      expect(result.failures).toContainEqual({
        reservationId: bad.id,
        reason: "level_inconsistent",
      });
      expect(await levelOf(pool, fine, mainId)).toEqual({ on_hand: 5, reserved: 0 });
      expect((await reservationsOf(pool, broken))[0]?.status).toBe("active");
      // The damaged reservation would be reported by every later sweep of the shared database.
      await pool.query("update reservation set status = 'released' where id = $1", [bad.id]);
    });

    it("rejects an invalid time or limit loudly", async () => {
      await expect(service.expireDue(new Date(Number.NaN))).rejects.toThrow(RangeError);
      await expect(service.expireDue(new Date(), { limit: 0 })).rejects.toThrow(RangeError);
    });
  });

  describe("journal", () => {
    it("is only ever appended to: no statement of this service updates or deletes stock_movement", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const held = await reserveOk(variantId, 2);
      await service.commit(held.id, { actorId });
      const journal = await movementsOf(pool, variantId);
      expect(journal.map((row) => row.kind)).toEqual(["receipt", "sale"]);
      expectJournalReplays(journal, 3);
    });
  });
});

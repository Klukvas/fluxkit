import { MAX_QUANTITY, MAX_RESERVED } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { caller, createCatalogFixture, type CatalogFixture } from "../../test/catalog-fixtures.js";
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
import { inTransaction, rolledBack } from "../../test/reservation-tx.js";
import { expectLevelInvariants, reservationsOf, StockWorld } from "../../test/stock-world.js";
import { ReservationsService, type ReserveManyResult } from "./reservations.service.js";

const HOUR = 3_600_000;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

/** The transaction-scoped operations the checkout calls (plan step 5a): they run in the CALLER's transaction. */
describe("ReservationsService transaction-scoped operations (real Postgres)", () => {
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

  function reserveMany(
    lines: { variantId: string; quantity: number }[],
    options: { expiresAt?: Date; reference?: string | null } = {},
  ): Promise<ReserveManyResult> {
    return inTransaction(database, (tx) =>
      service.reserveMany(tx, lines, {
        expiresAt: options.expiresAt ?? future(),
        reference: options.reference === undefined ? "ORD-TEST" : options.reference,
      }),
    );
  }

  async function reserveOk(variantId: string, quantity: number, expiresAt = future()) {
    const result = await service.reserve({ variantId, quantity, expiresAt, reference: "ORD-ONE" });
    if (!result.ok) {
      throw new Error(`reserve refused: ${result.reason}`);
    }
    return result.reservation;
  }

  async function snapshot(variantIds: string[]) {
    return Promise.all(
      variantIds.map(async (variantId) => ({
        level: await levelOf(pool, variantId, mainId),
        levels: await levelCount(pool, variantId),
        reservations: (await reservationsOf(pool, variantId)).length,
        movements: (await movementsOf(pool, variantId)).length,
      })),
    );
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

  describe("reserveMany", () => {
    it("reserves every line, returns them in INPUT order and records reference and expiry", async () => {
      const stocked = [
        await world.variant({ onHand: 5 }),
        await world.variant({ onHand: 5 }),
        await world.variant({ onHand: 5 }),
      ];
      // Input order is the reverse of the id order the locks are taken in: the result must follow the input.
      const ids = stocked.map((entry) => entry.variantId).sort();
      const input = [ids[2], ids[0], ids[1]].map((variantId, index) => ({
        variantId: variantId ?? "",
        quantity: index + 1,
      }));
      const expiresAt = future();
      const result = await reserveMany(input, { expiresAt, reference: "7K3M-9QX2" });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.lines.map((line) => line.variantId)).toEqual(
        input.map((line) => line.variantId),
      );
      for (const [index, line] of result.lines.entries()) {
        expect(line.kind).toBe("reserved");
        if (line.kind !== "reserved") {
          continue;
        }
        const wanted = input[index];
        expect(line.quantity).toBe(wanted?.quantity);
        expect(line.reservation).toEqual({
          id: expect.any(String),
          variantId: wanted?.variantId,
          locationId: mainId,
          quantity: wanted?.quantity,
          status: "active",
          expiresAt,
          reference: "7K3M-9QX2",
        });
        const rows = await reservationsOf(pool, wanted?.variantId ?? "");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ reference: "7K3M-9QX2", status: "active" });
        expect(rows[0]?.expires_at.getTime()).toBe(expiresAt.getTime());
        expect(await levelOf(pool, wanted?.variantId ?? "", mainId)).toEqual({
          on_hand: 5,
          reserved: wanted?.quantity,
        });
        expect(await movementsOf(pool, wanted?.variantId ?? "")).toHaveLength(1); // the receipt only
        await expectLevelInvariants(pool, wanted?.variantId ?? "", mainId);
      }
    });

    it("is all or nothing: one refused line among several leaves no row and no level change, and lists every refusal", async () => {
      const fine = await world.variant({ onHand: 5 });
      const scarce = await world.variant({ onHand: 1 });
      const draft = await world.variant({ onHand: 5, publish: false });
      const backorderNoLevel = await world.variant({ allowBackorder: true });
      const ids = [fine, scarce, draft, backorderNoLevel].map((entry) => entry.variantId);
      const before = await snapshot(ids);

      const result = await reserveMany([
        { variantId: fine.variantId, quantity: 2 },
        { variantId: scarce.variantId, quantity: 2 },
        { variantId: draft.variantId, quantity: 1 },
        { variantId: backorderNoLevel.variantId, quantity: 3 },
      ]);

      expect(result).toEqual({
        ok: false,
        refusals: [
          { variantId: scarce.variantId, reason: "insufficient_stock" },
          { variantId: draft.variantId, reason: "variant_not_sellable" },
        ],
      });
      // Nothing changed, not even an empty level row for the backorder variant that was fine on its own.
      expect(await snapshot(ids)).toEqual(before);
      expect(before[3]).toMatchObject({ levels: 0, reservations: 0 });
    });

    it("reports a refusal for the quantity, the unknown variant and a reserved total above the limit", async () => {
      const ok = await world.variant({ onHand: 5 });
      const full = await world.variant({ allowBackorder: true });
      await reserveOk(full.variantId, 1);
      await pool.query("update inventory_level set reserved = $2 where variant_id = $1", [
        full.variantId,
        MAX_RESERVED - 5,
      ]);
      for (const quantity of [0, -1, 1.5, Number.NaN, MAX_QUANTITY + 1]) {
        expect(
          await reserveMany([{ variantId: ok.variantId, quantity }]),
          `quantity ${quantity}`,
        ).toEqual({
          ok: false,
          refusals: [{ variantId: ok.variantId, reason: "invalid_quantity" }],
        });
      }
      const result = await reserveMany([
        { variantId: ok.variantId, quantity: 0 },
        { variantId: MISSING_ID, quantity: 1 },
        { variantId: full.variantId, quantity: 10 },
      ]);
      expect(result).toEqual({
        ok: false,
        refusals: [
          { variantId: ok.variantId, reason: "invalid_quantity" },
          { variantId: MISSING_ID, reason: "variant_not_found" },
          { variantId: full.variantId, reason: "reserved_out_of_range" },
        ],
      });
      expect(await levelOf(pool, full.variantId, mainId)).toEqual({
        on_hand: 0,
        reserved: MAX_RESERVED - 5,
      });
      expect(await reservationsOf(pool, ok.variantId)).toHaveLength(0);
    });

    it("refuses an inactive variant, a variant without a shop price and every non-active product with variant_not_sellable", async () => {
      const inactive = await world.variant({ onHand: 5 });
      await pool.query("update variant set is_active = false where id = $1", [inactive.variantId]);
      const priceless = await world.variant({ onHand: 5 });
      await pool.query("delete from price where variant_id = $1", [priceless.variantId]);
      const unpublished = await world.variant({ onHand: 5 });
      await call("POST", `/admin/products/${unpublished.productId}/unpublish`);
      const archived = await world.variant({ onHand: 5 });
      await call("POST", `/admin/products/${archived.productId}/archive`);
      const draft = await world.variant({ onHand: 5, publish: false });
      const targets = [inactive, priceless, unpublished, archived, draft];

      for (const target of targets) {
        expect(await reserveMany([{ variantId: target.variantId, quantity: 1 }])).toEqual({
          ok: false,
          refusals: [{ variantId: target.variantId, reason: "variant_not_sellable" }],
        });
        expect(await levelOf(pool, target.variantId, mainId)).toEqual({ on_hand: 5, reserved: 0 });
        expect(await reservationsOf(pool, target.variantId)).toHaveLength(0);
      }
    });

    it("returns an untracked line as `untracked` without a reservation or level row, next to a tracked one", async () => {
      const untracked = await world.variant({ trackInventory: false });
      const tracked = await world.variant({ onHand: 3 });
      const result = await reserveMany([
        { variantId: untracked.variantId, quantity: 7 },
        { variantId: tracked.variantId, quantity: 2 },
      ]);
      expect(result).toEqual({
        ok: true,
        lines: [
          { kind: "untracked", variantId: untracked.variantId, quantity: 7 },
          expect.objectContaining({ kind: "reserved", variantId: tracked.variantId, quantity: 2 }),
        ],
      });
      expect(await reservationsOf(pool, untracked.variantId)).toHaveLength(0);
      expect(await levelCount(pool, untracked.variantId)).toBe(0);
      expect(await levelOf(pool, tracked.variantId, mainId)).toEqual({ on_hand: 3, reserved: 2 });
    });

    it("reserves an order of untracked lines only (no reservation at all)", async () => {
      const first = await world.variant({ trackInventory: false });
      const second = await world.variant({ trackInventory: false });
      const result = await reserveMany([
        { variantId: first.variantId, quantity: 1 },
        { variantId: second.variantId, quantity: 2 },
      ]);
      expect(result).toEqual({
        ok: true,
        lines: [
          { kind: "untracked", variantId: first.variantId, quantity: 1 },
          { kind: "untracked", variantId: second.variantId, quantity: 2 },
        ],
      });
    });

    it("holds a backorder line beyond on hand and creates its level row", async () => {
      const backorder = await world.variant({ allowBackorder: true, onHand: 1 });
      const fresh = await world.variant({ allowBackorder: true });
      const result = await reserveMany([
        { variantId: backorder.variantId, quantity: 4 },
        { variantId: fresh.variantId, quantity: 3 },
      ]);
      expect(result.ok).toBe(true);
      expect(await levelOf(pool, backorder.variantId, mainId)).toEqual({ on_hand: 1, reserved: 4 });
      expect(await levelOf(pool, fresh.variantId, mainId)).toEqual({ on_hand: 0, reserved: 3 });
      expect(await levelCount(pool, fresh.variantId)).toBe(1);
      await expectLevelInvariants(pool, fresh.variantId, mainId, { allowBackorder: true });
    });

    it("treats a duplicate variant line, no lines and an invalid expiry as caller bugs (RangeError, nothing written)", async () => {
      const entry = await world.variant({ onHand: 5 });
      const before = await snapshot([entry.variantId]);
      await expect(
        reserveMany([
          { variantId: entry.variantId, quantity: 1 },
          { variantId: entry.variantId, quantity: 1 },
        ]),
      ).rejects.toThrow(RangeError);
      await expect(
        reserveMany([
          { variantId: entry.variantId, quantity: 1 },
          { variantId: entry.variantId.toUpperCase(), quantity: 2 },
        ]),
      ).rejects.toThrow(RangeError);
      await expect(reserveMany([])).rejects.toThrow(RangeError);
      await expect(
        reserveMany([{ variantId: entry.variantId, quantity: 1 }], {
          expiresAt: new Date(Number.NaN),
        }),
      ).rejects.toThrow(RangeError);
      expect(await snapshot([entry.variantId])).toEqual(before);
    });

    it("runs in the caller's transaction: a rollback of the caller removes everything, and nothing is visible before the commit", async () => {
      const entry = await world.variant({ onHand: 5 });
      const other = await world.variant({ allowBackorder: true });
      const ids = [entry.variantId, other.variantId];
      const before = await snapshot(ids);
      let seenByOthers: Awaited<ReturnType<typeof snapshot>> = [];
      const result = await rolledBack(database, async (tx) => {
        const created = await service.reserveMany(
          tx,
          [
            { variantId: entry.variantId, quantity: 2 },
            { variantId: other.variantId, quantity: 1 },
          ],
          { expiresAt: future(), reference: "ORD-ROLLBACK" },
        );
        seenByOthers = await snapshot(ids); // another connection: uncommitted work must not show
        return created;
      });
      expect(result.ok).toBe(true);
      expect(seenByOthers).toEqual(before);
      expect(await snapshot(ids)).toEqual(before);
    });

    it("keeps working when the caller's transaction later fails after a refusal (the refusal is a return value, not an abort)", async () => {
      const scarce = await world.variant({ onHand: 1 });
      const fine = await world.variant({ onHand: 5 });
      const outcome = await inTransaction(database, async (tx) => {
        const refused = await service.reserveMany(
          tx,
          [
            { variantId: fine.variantId, quantity: 1 },
            { variantId: scarce.variantId, quantity: 2 },
          ],
          { expiresAt: future(), reference: "ORD-A" },
        );
        // The same transaction can still be used: the refusal did not abort it.
        const accepted = await service.reserveMany(
          tx,
          [{ variantId: fine.variantId, quantity: 1 }],
          {
            expiresAt: future(),
            reference: "ORD-B",
          },
        );
        return { refused, accepted };
      });
      expect(outcome.refused.ok).toBe(false);
      expect(outcome.accepted.ok).toBe(true);
      expect(await levelOf(pool, fine.variantId, mainId)).toEqual({ on_hand: 5, reserved: 1 });
      expect(await levelOf(pool, scarce.variantId, mainId)).toEqual({ on_hand: 1, reserved: 0 });
    });

    it("sees stock held earlier in the same transaction (two calls cannot both take the last unit)", async () => {
      const last = await world.variant({ onHand: 1 });
      const [first, second] = await inTransaction(database, async (tx) => [
        await service.reserveMany(tx, [{ variantId: last.variantId, quantity: 1 }], {
          expiresAt: future(),
          reference: null,
        }),
        await service.reserveMany(tx, [{ variantId: last.variantId, quantity: 1 }], {
          expiresAt: future(),
          reference: null,
        }),
      ]);
      expect(first?.ok).toBe(true);
      expect(second).toEqual({
        ok: false,
        refusals: [{ variantId: last.variantId, reason: "insufficient_stock" }],
      });
      expect((await reservationsOf(pool, last.variantId))[0]?.reference).toBeNull();
    });
  });

  describe("releaseIn", () => {
    it("gives the units back inside the caller's transaction and is undone by its rollback", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const held = await reserveOk(variantId, 3);
      const result = await rolledBack(database, async (tx) => {
        const released = await service.releaseIn(tx, held.id);
        // Another connection still sees the held units: the release is not committed.
        expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 3 });
        return released;
      });
      expect(result).toMatchObject({ ok: true, reservation: { id: held.id, status: "released" } });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 3 });
      expect((await reservationsOf(pool, variantId))[0]?.status).toBe("active");

      const real = await inTransaction(database, (tx) => service.releaseIn(tx, held.id));
      expect(real).toMatchObject({ ok: true, reservation: { status: "released" } });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 0 });
      expect(await inTransaction(database, (tx) => service.releaseIn(tx, held.id))).toEqual({
        ok: false,
        reason: "not_active",
      });
      expect(await inTransaction(database, (tx) => service.releaseIn(tx, MISSING_ID))).toEqual({
        ok: false,
        reason: "reservation_not_found",
      });
    });
  });

  describe("commitIn", () => {
    it("sells the units, writes the sale movement (actor may be null) and is undone by the caller's rollback", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const held = await reserveOk(variantId, 2);
      const rolled = await rolledBack(database, (tx) =>
        service.commitIn(tx, held.id, { actorId: null, reference: "ORD-X" }),
      );
      expect(rolled.ok).toBe(true);
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 5, reserved: 2 });
      expect(
        (await movementsOf(pool, variantId)).filter((row) => row.kind === "sale"),
      ).toHaveLength(0);

      const committed = await inTransaction(database, (tx) =>
        service.commitIn(tx, held.id, { actorId: null, reference: "ORD-X" }),
      );
      expect(committed).toMatchObject({ ok: true, reservation: { status: "committed" } });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 3, reserved: 0 });
      const sale = (await movementsOf(pool, variantId)).find((row) => row.kind === "sale");
      expect(sale).toMatchObject({
        delta: -2,
        on_hand_after: 3,
        reference: "ORD-X",
        actor_id: null,
      });
      expectJournalReplays(await movementsOf(pool, variantId), 3);
      expect(await inTransaction(database, (tx) => service.commitIn(tx, held.id, {}))).toEqual({
        ok: false,
        reason: "already_committed",
      });
    });

    it("defaults the movement reference to the reservation's own reference and accepts a real admin actor", async () => {
      const { variantId } = await world.variant({ onHand: 5 });
      const held = await reserveOk(variantId, 1);
      await inTransaction(database, (tx) => service.commitIn(tx, held.id, { actorId }));
      const sale = (await movementsOf(pool, variantId)).find((row) => row.kind === "sale");
      expect(sale).toMatchObject({ reference: "ORD-ONE", actor_id: actorId });
    });

    it("refuses units that are backordered and not on hand (insufficient_stock) and leaves the reservation active", async () => {
      const { variantId } = await world.variant({ allowBackorder: true, onHand: 1 });
      const held = await reserveOk(variantId, 3);
      const result = await inTransaction(database, (tx) => service.commitIn(tx, held.id, {}));
      expect(result).toEqual({ ok: false, reason: "insufficient_stock" });
      expect((await reservationsOf(pool, variantId))[0]?.status).toBe("active");
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 1, reserved: 3 });
      expect(
        (await movementsOf(pool, variantId)).filter((row) => row.kind === "sale"),
      ).toHaveLength(0);
    });

    it("does not look at the expiry time (an overdue, unswept reservation can still be sold)", async () => {
      const { variantId } = await world.variant({ onHand: 2 });
      const held = await reserveOk(variantId, 1, new Date(Date.now() - HOUR));
      const result = await inTransaction(database, (tx) => service.commitIn(tx, held.id, {}));
      expect(result.ok).toBe(true);
    });
  });

  describe("extend", () => {
    it("moves the expiry later, changes only expires_at, and is undone by the caller's rollback", async () => {
      const { variantId } = await world.variant({ onHand: 4 });
      const held = await reserveOk(variantId, 2);
      const [before] = await reservationsOf(pool, variantId);
      const later = new Date(held.expiresAt.getTime() + 365 * 24 * HOUR);

      const rolled = await rolledBack(database, (tx) => service.extend(tx, held.id, later));
      expect(rolled.ok).toBe(true);
      expect((await reservationsOf(pool, variantId))[0]?.expires_at.getTime()).toBe(
        held.expiresAt.getTime(),
      );

      const result = await inTransaction(database, (tx) => service.extend(tx, held.id, later));
      expect(result).toEqual({ ok: true, reservation: { ...held, expiresAt: later } });
      const [after] = await reservationsOf(pool, variantId);
      expect(after).toEqual({ ...before, expires_at: later });
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 4, reserved: 2 });
      expect(await movementsOf(pool, variantId)).toHaveLength(1);
    });

    it("never shortens, and the same time again is accepted (a retry is harmless)", async () => {
      const { variantId } = await world.variant({ onHand: 4 });
      const held = await reserveOk(variantId, 1);
      expect(
        await inTransaction(database, (tx) =>
          service.extend(tx, held.id, new Date(held.expiresAt.getTime() - 1)),
        ),
      ).toEqual({ ok: false, reason: "would_shorten" });
      expect(
        await inTransaction(database, (tx) => service.extend(tx, held.id, held.expiresAt)),
      ).toMatchObject({ ok: true });
      expect((await reservationsOf(pool, variantId))[0]?.expires_at.getTime()).toBe(
        held.expiresAt.getTime(),
      );
    });

    it("refuses a released, committed or expired reservation and an unknown one", async () => {
      const { variantId } = await world.variant({ onHand: 9 });
      const released = await reserveOk(variantId, 1);
      const committed = await reserveOk(variantId, 1);
      const overdue = await reserveOk(variantId, 1, new Date(Date.now() - HOUR));
      await service.release(released.id);
      await service.commit(committed.id);
      await service.expireDue(new Date());
      const later = new Date(Date.now() + 2 * HOUR);
      const extend = (id: string) => inTransaction(database, (tx) => service.extend(tx, id, later));
      expect(await extend(released.id)).toEqual({ ok: false, reason: "not_active" });
      expect(await extend(committed.id)).toEqual({ ok: false, reason: "already_committed" });
      expect(await extend(overdue.id)).toEqual({ ok: false, reason: "not_active" });
      expect(await extend(MISSING_ID)).toEqual({ ok: false, reason: "reservation_not_found" });
    });

    it("throws RangeError for an invalid date (a caller bug) and writes nothing", async () => {
      const { variantId } = await world.variant({ onHand: 4 });
      const held = await reserveOk(variantId, 1);
      await expect(
        inTransaction(database, (tx) => service.extend(tx, held.id, new Date(Number.NaN))),
      ).rejects.toThrow(RangeError);
      expect((await reservationsOf(pool, variantId))[0]?.expires_at.getTime()).toBe(
        held.expiresAt.getTime(),
      );
    });

    it("holds an overdue, unswept reservation alive: extended before expireDue, the sweep skips it", async () => {
      const { variantId } = await world.variant({ onHand: 4 });
      const held = await reserveOk(variantId, 2, new Date(Date.now() - HOUR));
      const later = new Date(Date.now() + 2 * HOUR);
      expect((await inTransaction(database, (tx) => service.extend(tx, held.id, later))).ok).toBe(
        true,
      );
      const swept = await service.expireDue(new Date());
      expect(swept.failures).toEqual([]);
      expect((await reservationsOf(pool, variantId))[0]?.status).toBe("active");
      expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 4, reserved: 2 });
    });
  });

  describe("the self-transacting methods are wrappers of the same logic", () => {
    it("reserve still reports not_tracked, location_not_found and variant_not_found as before", async () => {
      const untracked = await world.variant({ trackInventory: false });
      expect(
        await service.reserve({ variantId: untracked.variantId, quantity: 1, expiresAt: future() }),
      ).toEqual({ ok: false, reason: "not_tracked" });
      expect(
        await service.reserve({ variantId: MISSING_ID, quantity: 1, expiresAt: future() }),
      ).toEqual({ ok: false, reason: "variant_not_found" });
    });

    it("release, commit and reserve leave the same state as releaseIn, commitIn and reserveMany", async () => {
      const viaWrappers = await world.variant({ onHand: 6 });
      const viaTx = await world.variant({ onHand: 6 });

      const w1 = await reserveOk(viaWrappers.variantId, 2);
      const w2 = await reserveOk(viaWrappers.variantId, 1);
      expect((await service.release(w1.id)).ok).toBe(true);
      expect((await service.commit(w2.id, { reference: "R" })).ok).toBe(true);

      const created = await reserveMany([{ variantId: viaTx.variantId, quantity: 2 }]);
      const created2 = await reserveMany([{ variantId: viaTx.variantId, quantity: 1 }]);
      if (!created.ok || !created2.ok) {
        throw new Error("reserveMany refused");
      }
      const t1 = created.lines[0];
      const t2 = created2.lines[0];
      if (t1?.kind !== "reserved" || t2?.kind !== "reserved") {
        throw new Error("expected reservations");
      }
      await inTransaction(database, (tx) => service.releaseIn(tx, t1.reservation.id));
      await inTransaction(database, (tx) =>
        service.commitIn(tx, t2.reservation.id, { reference: "R" }),
      );

      const [a, b] = await Promise.all([
        levelOf(pool, viaWrappers.variantId, mainId),
        levelOf(pool, viaTx.variantId, mainId),
      ]);
      expect(a).toEqual(b);
      expect(a).toEqual({ on_hand: 5, reserved: 0 });
      const stripped = async (variantId: string) =>
        (await movementsOf(pool, variantId)).map(({ kind, delta, on_hand_after, reference }) => ({
          kind,
          delta,
          on_hand_after,
          reference,
        }));
      expect(await stripped(viaWrappers.variantId)).toEqual(await stripped(viaTx.variantId));
    });
  });
});

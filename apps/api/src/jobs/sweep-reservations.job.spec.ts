import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { CartCatalog } from "../test/cart-fixtures.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { defaultLocationId, levelOf } from "../test/inventory-fixtures.js";
import { ensureMigrated } from "../test/migrate.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { sweepReservations } from "./sweep-reservations.job.js";

const START = new Date("2025-06-01T08:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("sweepReservations (real Postgres, injected time)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const catalog = new CartCatalog(pool);
  let running: RunningApp;
  let reservations: ReservationsService;
  let mainId = "";

  /** A tracked variant with `onHand` units; every test makes its own, so levels are exact. */
  async function variant(onHand = 20): Promise<string> {
    return (await catalog.simple({ trackInventory: true, onHand })).variantId;
  }

  async function hold(variantId: string, quantity: number, expiresAt: Date): Promise<string> {
    const result = await reservations.reserve({ variantId, quantity, expiresAt, reference: "orphan" });
    if (!result.ok) {
      throw new Error(`Test setup: reserve refused: ${result.reason}`);
    }
    return result.reservation.id;
  }

  async function statuses(ids: readonly string[]): Promise<string[]> {
    const result = await pool.query<{ status: string }>(
      "select status from reservation where id = any($1::uuid[]) order by expires_at, id",
      [ids],
    );
    return result.rows.map((row) => row.status);
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    reservations = running.app.get(ReservationsService, { strict: false });
    mainId = await defaultLocationId(pool);
    await catalog.init();
  });

  afterEach(async () => {
    await pool.query("delete from reservation where reference = 'orphan'");
  });

  afterAll(async () => {
    await running.app.close();
    await catalog.cleanup();
    await pool.end();
  });

  it("does nothing when nothing is due: one call, no failures", async () => {
    expect(await sweepReservations({ reservations }, START)).toEqual({
      scanned: 0,
      expired: 0,
      skipped: 0,
      failures: [],
      iterations: 1,
      truncated: false,
    });
  });

  it("expires a due reservation at exactly its time and gives the units back; a second run finds nothing", async () => {
    const variantId = await variant();
    const expiresAt = new Date(START.getTime() + 5 * MINUTE);
    const id = await hold(variantId, 3, expiresAt);
    expect(await sweepReservations({ reservations }, new Date(expiresAt.getTime() - 1))).toMatchObject({
      scanned: 0,
    });
    expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 20, reserved: 3 });

    const result = await sweepReservations({ reservations }, expiresAt);
    expect(result).toMatchObject({ scanned: 1, expired: 1, failures: [], truncated: false });
    expect(await statuses([id])).toEqual(["expired"]);
    expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 20, reserved: 0 });
    expect(await sweepReservations({ reservations }, expiresAt)).toMatchObject({
      scanned: 0,
      expired: 0,
    });
  });

  it("follows nextCursor until it is null, also when the count is an exact multiple of the page", async () => {
    const variantId = await variant();
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      ids.push(await hold(variantId, 1, new Date(START.getTime() + (index + 1) * MINUTE)));
    }
    const result = await sweepReservations({ reservations }, new Date(START.getTime() + HOUR), {
      limit: 2,
    });
    // Two full pages, then an empty one that ends the loop.
    expect(result).toMatchObject({ scanned: 4, expired: 4, iterations: 3, truncated: false });
    expect(await statuses(ids)).toEqual(["expired", "expired", "expired", "expired"]);
    expect(await levelOf(pool, variantId, mainId)).toEqual({ on_hand: 20, reserved: 0 });
  });

  it("stops at maxIterations, says so, and the next run finishes", async () => {
    const variantId = await variant();
    for (let index = 0; index < 3; index += 1) {
      await hold(variantId, 1, new Date(START.getTime() + (index + 1) * MINUTE));
    }
    const now = new Date(START.getTime() + HOUR);
    const first = await sweepReservations({ reservations }, now, { limit: 1, maxIterations: 2 });
    expect(first).toMatchObject({ scanned: 2, expired: 2, iterations: 2, truncated: true });
    const second = await sweepReservations({ reservations }, now, { limit: 1, maxIterations: 5 });
    expect(second).toMatchObject({ scanned: 1, expired: 1, truncated: false });
  });

  it("reports a reservation it cannot expire, still expires the others and does not spin on it", async () => {
    const broken = await variant(5);
    const fine = await variant(5);
    const early = new Date(START.getTime() + MINUTE);
    const badId = await hold(broken, 3, early);
    const goodId = await hold(fine, 1, new Date(START.getTime() + 2 * MINUTE));
    await pool.query("update inventory_level set reserved = 0 where variant_id = $1", [broken]);

    // A page of one: the damaged reservation is first in line and the cursor has to move past it.
    const result = await sweepReservations({ reservations }, new Date(START.getTime() + HOUR), {
      limit: 1,
    });
    expect(result.failures).toEqual([{ reservationId: badId, reason: "level_inconsistent" }]);
    expect(result).toMatchObject({ expired: 1, truncated: false });
    expect(await statuses([badId, goodId])).toEqual(["active", "expired"]);
  });

  it("refuses a nonsensical iteration limit", async () => {
    await expect(sweepReservations({ reservations }, START, { maxIterations: 0 })).rejects.toThrow(
      RangeError,
    );
  });
});

import { randomUUID } from "node:crypto";
import type pg from "pg";
import { expect } from "vitest";
import type { AdminAuthenticator } from "../auth/admin-authenticator.js";
import { testPrincipal } from "./allow-all-admin-authenticator.js";

/**
 * TEST ONLY. Inserts a real admin user and returns its id. The default test principal has a made-up id that is not a
 * row of `admin_user`, so a spec that writes `stock_movement.actor_id` (a foreign key) signs in as a real user.
 */
export async function insertAdminUserRow(pool: pg.Pool): Promise<string> {
  const result = await pool.query(
    `insert into admin_user (email, password_hash, role)
     values ($1, 'scrypt$16$8$1$test$test', 'owner') returning id`,
    [`stock-test-${randomUUID()}@example.test`],
  );
  return (result.rows[0] as { id: string }).id;
}

/** Signs every request in as an owner whose id is `userId` (see `insertAdminUserRow`). */
export function ownerAuthenticator(userId: string): AdminAuthenticator {
  return { authenticate: () => ({ ...testPrincipal("owner"), userId }) };
}

export async function defaultLocationId(pool: pg.Pool): Promise<string> {
  const result = await pool.query("select id from location where is_default");
  return (result.rows[0] as { id: string }).id;
}

/** A second location for multi-location specs. `code` must start with a letter and be lower case. */
export async function insertLocation(pool: pg.Pool, code: string): Promise<string> {
  const result = await pool.query(
    "insert into location (code, name) values ($1, $2) returning id",
    [code, `Location ${code}`],
  );
  return (result.rows[0] as { id: string }).id;
}

export interface LevelRow {
  on_hand: number;
  reserved: number;
}

export async function levelOf(
  pool: pg.Pool,
  variantId: string,
  locationId: string,
): Promise<LevelRow | undefined> {
  const result = await pool.query(
    "select on_hand, reserved from inventory_level where variant_id = $1 and location_id = $2",
    [variantId, locationId],
  );
  return result.rows[0] as LevelRow | undefined;
}

export async function levelCount(pool: pg.Pool, variantId: string): Promise<number> {
  const result = await pool.query(
    "select count(*)::int as count from inventory_level where variant_id = $1",
    [variantId],
  );
  return (result.rows[0] as { count: number }).count;
}

export interface MovementRow {
  kind: string;
  delta: number;
  on_hand_after: number;
  reason: string | null;
  reference: string | null;
  actor_id: string | null;
  location_id: string;
}

/** The journal of a variant in write order (the timestamp is taken under the row lock, so it is the lock order). */
export async function movementsOf(pool: pg.Pool, variantId: string): Promise<MovementRow[]> {
  const result = await pool.query(
    `select kind, delta, on_hand_after, reason, reference, actor_id, location_id
       from stock_movement where variant_id = $1 order by created_at, id`,
    [variantId],
  );
  return result.rows as MovementRow[];
}

/**
 * The journal must replay: each row's `on_hand_after` is the previous one plus its delta (per location, starting at
 * 0), and the level ends where the journal ends. Pass the expected final `on_hand` to compare with the level.
 */
export function expectJournalReplays(movements: readonly MovementRow[], finalOnHand: number): void {
  let running = 0;
  for (const [index, movement] of movements.entries()) {
    running += movement.delta;
    expect(movement.on_hand_after, `journal row ${index}`).toBe(running);
  }
  expect(running, "the level equals the sum of the movement deltas").toBe(finalOnHand);
}

/**
 * Proves that a stock write takes the `inventory_level` row lock: another transaction holds `FOR NO KEY UPDATE` on the
 * row, the request must not finish until that transaction ends, and then it must give `expectedStatus` (or pass
 * `check`). Like `expectWaitsForProductLock`: outcome-based concurrency tests cannot show a missing lock.
 */
export async function expectWaitsForLevelLock<T>(
  pool: pg.Pool,
  variantId: string,
  locationId: string,
  request: () => Promise<T>,
  check: (result: T) => void,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query(
      "select 1 from inventory_level where variant_id = $1 and location_id = $2 for no key update",
      [variantId, locationId],
    );
    expect(locked.rowCount, "the level row to lock exists").toBe(1);
    let settled = false;
    const pending = request().then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled, "the operation must wait for the inventory_level row lock").toBe(false);
    await client.query("commit");
    check(await pending);
  } finally {
    // A no-op after the commit; unblocks the request when an expectation failed above.
    await client.query("rollback");
    client.release();
  }
}

/**
 * Proves that `ReservationsService.reserve` takes the `variant` row lock (`FOR SHARE`): another transaction holds the
 * row `FOR NO KEY UPDATE` (what an UPDATE of a flag or of the activity does), the request must not finish until that
 * transaction ends, and then it must pass `check`. It is not `FOR UPDATE` on purpose: that would also block the
 * foreign key check (`FOR KEY SHARE`) of the reservation insert and hide a missing `FOR SHARE` in the lookup.
 */
export async function expectWaitsForVariantLock<T>(
  pool: pg.Pool,
  variantId: string,
  request: () => Promise<T>,
  check: (result: T) => void,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query("select 1 from variant where id = $1 for no key update", [
      variantId,
    ]);
    expect(locked.rowCount, "the variant row to lock exists").toBe(1);
    let settled = false;
    const pending = request().then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled, "the operation must wait for the variant row lock").toBe(false);
    await client.query("commit");
    check(await pending);
  } finally {
    // A no-op after the commit; unblocks the request when an expectation failed above.
    await client.query("rollback");
    client.release();
  }
}

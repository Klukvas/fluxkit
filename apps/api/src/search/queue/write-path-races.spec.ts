import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReservationsService } from "../../inventory/reservations/reservations.service.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  caller,
  createCatalogFixture,
  type Call,
  type CatalogFixture,
} from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import {
  defaultLocationId,
  insertAdminUserRow,
  ownerAuthenticator,
} from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { priceProductVariants } from "../../test/pricing-fixtures.js";
import { meiliUrl } from "../../test/search-engine.js";
import { expectLevelInvariants, StockWorld } from "../../test/stock-world.js";

/**
 * The search mark sits on the hottest write path (every reservation, release, commit and expiry). Concurrent holds and
 * batch releases on the variants of ONE product must neither deadlock nor lose a mark: the mark is taken once per call,
 * after every level lock, in product id order (ADR 0034 decision 5).
 */
describe("search write path under concurrent reservations (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let app: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let reservations: ReservationsService;
  let database: Database;
  let productId: string;
  let otherProductId: string;
  let variantIds: string[];
  let adminId: string;

  beforeAll(async () => {
    await ensureMigrated();
    adminId = await insertAdminUserRow(pool);
    app = await startApp({
      search: {
        enabled: true,
        meiliUrl: meiliUrl(),
        meiliApiKey: "races-spec-key-0123456789",
        indexPrefix: "races_",
      },
      adminAuthenticator: ownerAuthenticator(adminId),
    });
    call = caller(() => app.baseUrl);
    fx = await createCatalogFixture(call);
    reservations = app.app.get(ReservationsService);
    database = app.app.get<Database>(DRIZZLE);
    const world = new StockWorld(call, pool, fx);

    const product = await world.createProduct();
    productId = product.id;
    const options = await call("PUT", `/admin/products/${productId}/options`, {
      options: [{ optionId: fx.size.id, valueIds: Object.values(fx.size.values) }],
    });
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    await priceProductVariants(pool, productId);
    expect((await call("POST", `/admin/products/${productId}/publish`)).status).toBe(200);
    const rows = await pool.query<{ id: string }>(
      "select id from variant where product_id = $1 order by id",
      [productId],
    );
    variantIds = rows.rows.map((row) => row.id);
    expect(variantIds.length).toBe(3);
    for (const variantId of variantIds) {
      await world.receive({ productId, variantId }, 1_000);
    }
    const other = await world.variant({ onHand: 1_000 });
    otherProductId = other.productId;
    variantIds.push(other.variantId);
  }, 120_000);

  afterAll(async () => {
    await fx.cleanup(pool);
    await pool.query("delete from search_sync_queue");
    await app.app.close();
    // An owner left behind would change the last-owner rule for later spec files of the shared database.
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  it("parallel holds, batch releases and commits of crossing variants all succeed and leave one mark per product", async () => {
    // Warm both pools so the work really runs at the same time instead of waiting for connections.
    const warm = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    for (const client of warm) client.release();
    await Promise.all(Array.from({ length: 10 }, () => database.execute("select 1")));
    await pool.query("delete from search_sync_queue");

    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const holds = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        reservations.reserve({
          variantId: variantIds[index % variantIds.length] ?? "",
          quantity: 1,
          expiresAt,
        }),
      ),
    );
    expect(holds.every((hold) => hold.ok)).toBe(true);
    const ids = holds.flatMap((hold) => (hold.ok ? [hold.reservation.id] : []));
    const seqBefore = await pool.query<{ product_id: string; change_seq: string }>(
      "select product_id, change_seq from search_sync_queue",
    );
    expect(seqBefore.rows.map((row) => row.product_id).sort()).toEqual(
      [productId, otherProductId].sort(),
    );

    // Crossing batches in parallel: each releases or commits reservations of several variants, given in reverse or
    // shuffled order (the service sorts its level locks; the mark comes after them).
    const batches = [ids.slice(0, 6), ids.slice(6, 12).reverse(), ids.slice(12, 18), ids.slice(18)];
    const outcomes = await Promise.allSettled(
      batches.flatMap((batch, index) => [
        withTransaction(database, (tx) =>
          index % 2 === 0
            ? reservations.releaseManyIn(tx, batch.slice(0, 3))
            : reservations.commitManyIn(tx, batch.slice(0, 3)),
        ),
        withTransaction(database, (tx) =>
          reservations.releaseManyIn(tx, [...batch.slice(3)].reverse()),
        ),
        reservations.reserve({
          variantId: variantIds[index] ?? "",
          quantity: 2,
          expiresAt,
        }),
      ]),
    );
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual([]);

    const after = await pool.query<{ product_id: string; change_seq: string; reason: string }>(
      "select product_id, change_seq, reason from search_sync_queue order by product_id",
    );
    expect(after.rows.map((row) => row.product_id)).toEqual([productId, otherProductId].sort());
    for (const row of after.rows) {
      const before = seqBefore.rows.find((candidate) => candidate.product_id === row.product_id);
      expect(Number(row.change_seq)).toBeGreaterThan(Number(before?.change_seq));
      expect(row.reason).toBe("reservation_changed");
    }
    const locationId = await defaultLocationId(pool);
    for (const variantId of variantIds) {
      await expectLevelInvariants(pool, variantId, locationId);
    }
  });
});

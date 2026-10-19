import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import type { ProductDetailResponse } from "../../catalog/admin/products/products.schemas.js";
import { PG_POOL } from "../../database/database.module.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  caller,
  createCatalogFixture,
  type Call,
  type CatalogFixture,
} from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import {
  defaultLocationId,
  insertAdminUserRow,
  insertLocation,
  ownerAuthenticator,
} from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import type { InventoryResponse } from "./inventory.schemas.js";
import { defined } from "../../test/defined.js";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

interface ProductInventory {
  items: InventoryResponse[];
}

describe("GET /admin/products/:id/inventory (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let viewer: RunningApp;
  let anonymous: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let mainId: string;
  let secondId: string;
  let adminId = "";
  let counter = 0;
  const locationCode = `wh${Math.random().toString(36).slice(2, 8)}`;

  async function withOptions(options: { optionId: string; valueIds: string[] }[]) {
    counter += 1;
    const created = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: fx.teeTypeId,
      title: { uk: `Склад ${fx.runId} ${counter}` },
      attributes: { [fx.materialAttributeCode]: "cotton" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const put = await call<ProductDetailResponse>(
      "PUT",
      `/admin/products/${created.body.id}/options`,
      { options },
    );
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    return put.body;
  }

  const threeVariants = () =>
    withOptions([
      {
        optionId: fx.color.id,
        valueIds: [
          defined(fx.color.values["red"]),
          defined(fx.color.values["blue"]),
          defined(fx.color.values["green"]),
        ],
      },
    ]);

  const receive = (productId: string, variantId: string, quantity: number, locationId?: string) =>
    call("POST", `/admin/products/${productId}/variants/${variantId}/inventory/adjustments`, {
      kind: "receipt",
      delta: quantity,
      ...(locationId === undefined ? {} : { locationId }),
    });

  const read = (productId: string) =>
    call<ProductInventory>("GET", `/admin/products/${productId}/inventory`);

  beforeAll(async () => {
    await ensureMigrated();
    adminId = await insertAdminUserRow(pool);
    running = await startApp({ adminAuthenticator: ownerAuthenticator(adminId) });
    viewer = await startApp({ adminPrincipal: { role: "viewer" } });
    anonymous = await startApp({ adminAuthenticator: "production-default" });
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    mainId = await defaultLocationId(pool);
    secondId = await insertLocation(pool, locationCode);
  });

  afterAll(async () => {
    for (const started of [running, viewer, anonymous]) {
      await started.app.close();
    }
    await fx.cleanup(pool);
    await pool
      .query("delete from stock_movement where location_id = $1", [secondId])
      .catch(() => undefined);
    await pool.query("delete from inventory_level where location_id = $1", [secondId]);
    await pool.query("delete from location where id = $1", [secondId]);
    // An owner row left behind would break the "last owner" specs of the auth suite that share the database.
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  it("shows every variant with its levels per location and its total available", async () => {
    const product = await threeVariants();
    const [first, second, third] = product.variants;
    expect((await receive(product.id, defined(first).id, 10)).status).toBe(201);
    expect((await receive(product.id, defined(first).id, 5, secondId)).status).toBe(201);
    expect((await receive(product.id, defined(second).id, 3)).status).toBe(201);
    await pool.query(
      "update inventory_level set reserved = 2 where variant_id = $1 and location_id = $2",
      [defined(first).id, mainId],
    );

    const result = await read(product.id);
    expect(result.status).toBe(200);
    expect(Object.keys(result.body)).toEqual(["items"]);
    expect(result.body.items.map((item) => item.variantId)).toEqual(
      [first, second, third].map((variant) => defined(variant).id),
    );
    const [one, two, none] = result.body.items;
    expect(
      one?.levels.map((level) => [
        level.locationCode,
        level.onHand,
        level.reserved,
        level.available,
      ]),
    ).toEqual(
      [
        ["main", 10, 2, 8],
        [locationCode, 5, 0, 5],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(one?.totalAvailable).toBe(13);
    expect(two).toMatchObject({ totalAvailable: 3 });
    expect(two?.levels).toHaveLength(1);
    // A variant that never had stock is listed with no levels (reads create nothing).
    expect(none).toMatchObject({ variantId: defined(third).id, levels: [], totalAvailable: 0 });
    const levelRows = await pool.query(
      "select count(*)::int as n from inventory_level where variant_id = $1",
      [defined(third).id],
    );
    expect((levelRows.rows[0] as { n: number }).n).toBe(0);
  });

  it("gives each item exactly what the per-variant read gives, flags included", async () => {
    const product = await threeVariants();
    const [first, second] = product.variants;
    await receive(product.id, defined(first).id, 4);
    await call("PATCH", `/admin/products/${product.id}/variants/${defined(second).id}`, {
      trackInventory: false,
      allowBackorder: true,
    });
    const all = (await read(product.id)).body.items;
    for (const variant of product.variants) {
      const own = await call<InventoryResponse>(
        "GET",
        `/admin/products/${product.id}/variants/${variant.id}/inventory`,
      );
      expect(all.find((item) => item.variantId === variant.id)).toEqual(own.body);
    }
    expect(all.find((item) => item.variantId === defined(second).id)).toMatchObject({
      trackInventory: false,
      allowBackorder: true,
    });
  });

  it("lists only the levels of this product", async () => {
    const mine = await threeVariants();
    const other = await threeVariants();
    await receive(other.id, defined(other.variants[0]).id, 99);
    const result = await read(mine.id);
    expect(result.body.items.every((item) => item.totalAvailable === 0)).toBe(true);
    expect(result.body.items).toHaveLength(3);
  });

  it("answers 404 for an unknown product and 400 for a malformed id", async () => {
    const missing = await call<ProblemBody>("GET", `/admin/products/${MISSING_ID}/inventory`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: "not_found" });
    expect((await call("GET", "/admin/products/xyz/inventory")).status).toBe(400);
  });

  it("needs catalog.read, like the per-variant read: a viewer may read, nobody anonymous may", async () => {
    const product = await threeVariants();
    expect(
      (await http(viewer.baseUrl, "GET", `/admin/products/${product.id}/inventory`)).status,
    ).toBe(200);
    expect(
      (await http(anonymous.baseUrl, "GET", `/admin/products/${product.id}/inventory`)).status,
    ).toBe(401);
  });

  it("issues the same number of statements for 3 and for 200+ variants, with levels in two locations", async () => {
    const small = await threeVariants();
    await receive(small.id, defined(small.variants[0]).id, 1);
    const large = await withOptions([
      { optionId: fx.biga.id, valueIds: Object.values(fx.biga.values) },
      { optionId: fx.bigb.id, valueIds: Object.values(fx.bigb.values).slice(0, 8) },
    ]);
    expect(large.variants.length).toBeGreaterThan(100);
    // One level in each location for every variant, written straight into the table (a request per variant is too slow).
    await pool.query(
      `insert into inventory_level (variant_id, location_id, on_hand, reserved)
       select v.id, l.id, 5, 0 from variant v cross join location l
        where v.product_id = $1 and l.id in ($2, $3)`,
      [large.id, mainId, secondId],
    );
    const listed = await read(large.id);
    expect(listed.body.items).toHaveLength(large.variants.length);
    expect(
      listed.body.items.every((item) => item.levels.length === 2 && item.totalAvailable === 10),
    ).toBe(true);

    async function statements(productId: string): Promise<number> {
      const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
      const spy = vi.spyOn(poolOfApp, "query");
      try {
        expect((await read(productId)).status).toBe(200);
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    }
    const smallCount = await statements(small.id);
    expect(await statements(large.id)).toBe(smallCount);
    expect(smallCount).toBe(3);
  });
});

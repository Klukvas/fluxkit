import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ReservationsService } from "../../inventory/reservations/reservations.service.js";
import { startApp, type RunningApp } from "../../test/app.js";
import {
  caller,
  createCatalogFixture,
  type Call,
  type CatalogFixture,
} from "../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { insertAdminUserRow, ownerAuthenticator } from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import { priceProductVariants } from "../../test/pricing-fixtures.js";
import { StockWorld } from "../../test/stock-world.js";
import { meiliUrl } from "../../test/search-engine.js";

/**
 * Every catalog, price, stock and reservation write that can change a search document marks its products in
 * `search_sync_queue` in its own transaction (ADR 0034 decision 5); fan-out writers mark every affected product or, above
 * the limit, request a rebuild; with `SEARCH_ENABLED=false` nothing at all is written (AGENTS.md section 2.1).
 * The write path makes no engine call, so an invented key is enough here.
 */
const searchOn = (prefix: string) => ({
  enabled: true as const,
  meiliUrl: meiliUrl(),
  meiliApiKey: "write-path-spec-key-0123456789",
  indexPrefix: prefix,
  engineMaxConcurrency: 8,
  engineMaxQueue: 64,
});

describe("search write path (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let on: RunningApp;
  let off: RunningApp;
  let small: RunningApp;
  let call: Call;
  let callOff: Call;
  let callSmall: Call;
  let fx: CatalogFixture;
  let world: StockWorld;
  let adminId: string;

  beforeAll(async () => {
    await ensureMigrated();
    // Stock adjustments record the admin as the movement's actor: a real user row.
    adminId = await insertAdminUserRow(pool);
    const adminAuthenticator = ownerAuthenticator(adminId);
    on = await startApp({ search: searchOn("writepath_"), adminAuthenticator });
    off = await startApp({ adminAuthenticator });
    small = await startApp({
      search: searchOn("writepath_"),
      searchTuning: { fanOutRebuildThreshold: 1 },
      adminAuthenticator,
    });
    call = caller(() => on.baseUrl);
    callOff = caller(() => off.baseUrl);
    callSmall = caller(() => small.baseUrl);
    fx = await createCatalogFixture(call);
    world = new StockWorld(call, pool, fx);
  }, 120_000);

  beforeEach(async () => {
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
  });

  afterAll(async () => {
    await fx.cleanup(pool);
    await pool.query("delete from search_sync_queue");
    await pool.query("delete from search_index_state");
    await on.app.close();
    await off.app.close();
    await small.app.close();
    // An owner left behind would change the last-owner rule for later spec files of the shared database.
    await pool.query("delete from admin_user where id = $1", [adminId]);
    await pool.end();
  });

  async function marked(): Promise<Record<string, string>> {
    const result = await pool.query<{ product_id: string; reason: string }>(
      "select product_id, reason from search_sync_queue",
    );
    return Object.fromEntries(result.rows.map((row) => [row.product_id, row.reason]));
  }

  async function clear(): Promise<void> {
    await pool.query("delete from search_sync_queue");
  }

  async function ok(result: { status: number; body: unknown }, status = 200): Promise<void> {
    expect(result.status, JSON.stringify(result.body)).toBe(status);
  }

  async function brandWithProducts(
    count: number,
    via: Call = call,
    creator: StockWorld = world,
  ): Promise<{ brandId: string; productIds: string[] }> {
    const brand = await via<{ id: string }>("POST", "/admin/brands", {
      name: { uk: `Бренд ${fx.runId} ${Math.random()}` },
    });
    await ok(brand, 201);
    const productIds: string[] = [];
    for (let index = 0; index < count; index++) {
      const product = await creator.createProduct();
      await ok(await via("PATCH", `/admin/products/${product.id}`, { brandId: brand.body.id }));
      productIds.push(product.id);
    }
    return { brandId: brand.body.id, productIds };
  }

  describe("product, variant, price and stock writes mark their product", () => {
    it("product create, update, lifecycle, categories and delete", async () => {
      const product = await world.createProduct();
      expect(await marked()).toEqual({ [product.id]: "product_changed" });

      await clear();
      await ok(
        await call("PATCH", `/admin/products/${product.id}`, { title: { uk: "Нова назва" } }),
      );
      expect(await marked()).toEqual({ [product.id]: "product_changed" });

      await priceProductVariants(pool, product.id);
      for (const action of ["publish", "unpublish", "publish", "archive", "restore"]) {
        await clear();
        await ok(await call("POST", `/admin/products/${product.id}/${action}`));
        expect(await marked(), action).toEqual({ [product.id]: "product_changed" });
      }

      await clear();
      await ok(await call("PUT", `/admin/products/${product.id}/categories`, { categories: [] }));
      expect(await marked()).toEqual({ [product.id]: "product_changed" });

      // Media is not part of a search document: no mark.
      await clear();
      await ok(await call("PUT", `/admin/products/${product.id}/media`, { media: [] }));
      expect(await marked()).toEqual({});

      const draft = await world.createProduct();
      await clear();
      await ok(await call("DELETE", `/admin/products/${draft.id}`), 204);
      // A tombstone: the product is gone, its row stays so the index loses its documents.
      expect(await marked()).toEqual({ [draft.id]: "product_changed" });
    });

    it("a failed write leaves no mark (the mark is in the same transaction)", async () => {
      const product = await world.createProduct();
      await clear();
      const refused = await call("PATCH", `/admin/products/${product.id}`, {
        brandId: "00000000-0000-4000-8000-000000000000",
      });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(await marked()).toEqual({});
    });

    it("variant create, update, generate and delete; product options", async () => {
      const product = await world.createProduct();
      await clear();
      await ok(
        await call("PUT", `/admin/products/${product.id}/options`, {
          options: [{ optionId: fx.size.id, valueIds: [fx.size.values["s"], fx.size.values["m"]] }],
        }),
      );
      expect(await marked()).toEqual({ [product.id]: "variant_changed" });

      await clear();
      const generated = await call<{ created: { id: string }[] }>(
        "POST",
        `/admin/products/${product.id}/variants/generate`,
      );
      expect(generated.status, JSON.stringify(generated.body)).toBeLessThan(300);
      expect(await marked()).toEqual({ [product.id]: "variant_changed" });

      const variants = await pool.query<{ id: string }>(
        "select id from variant where product_id = $1 order by position",
        [product.id],
      );
      const variantId = variants.rows.at(-1)?.id ?? "";
      await clear();
      await ok(
        await call("PATCH", `/admin/products/${product.id}/variants/${variantId}`, {
          isActive: false,
        }),
      );
      expect(await marked()).toEqual({ [product.id]: "variant_changed" });

      await clear();
      await ok(
        await call("POST", `/admin/products/${product.id}/options/${fx.size.id}/values`, {
          valueId: fx.size.values["l"],
        }),
        201,
      );
      expect(await marked()).toEqual({ [product.id]: "variant_changed" });

      await clear();
      await ok(await call("DELETE", `/admin/products/${product.id}/variants/${variantId}`), 204);
      expect(await marked()).toEqual({ [product.id]: "variant_changed" });
    });

    it("prices: one, many and a delete", async () => {
      const product = await world.createProduct();
      const variantId = product.variants[0]?.id ?? "";
      await clear();
      const priced = await call(
        "PUT",
        `/admin/products/${product.id}/variants/${variantId}/prices/UAH`,
        { amount: 1234 },
      );
      expect(priced.status, JSON.stringify(priced.body)).toBeLessThan(300);
      expect(await marked()).toEqual({ [product.id]: "price_changed" });

      await clear();
      await ok(
        await call("PUT", `/admin/products/${product.id}/prices`, {
          items: [{ variantId, currency: "EUR", amount: 99 }],
        }),
      );
      expect(await marked()).toEqual({ [product.id]: "price_changed" });

      await clear();
      await ok(
        await call("DELETE", `/admin/products/${product.id}/variants/${variantId}/prices/EUR`),
        204,
      );
      expect(await marked()).toEqual({ [product.id]: "price_changed" });
    });

    it("stock adjustments and every reservation change", async () => {
      const stocked = await world.variant({ onHand: 5 });
      await clear();
      await world.receive(stocked, 3);
      expect(await marked()).toEqual({ [stocked.productId]: "stock_changed" });

      const reservations = on.app.get(ReservationsService);
      const expiresAt = new Date(Date.now() + 60_000);
      await clear();
      const held = await reservations.reserve({
        variantId: stocked.variantId,
        quantity: 2,
        expiresAt,
      });
      expect(held.ok).toBe(true);
      expect(await marked()).toEqual({ [stocked.productId]: "reservation_changed" });

      await clear();
      if (!held.ok) throw new Error("unreachable");
      await reservations.release(held.reservation.id);
      expect(await marked()).toEqual({ [stocked.productId]: "reservation_changed" });

      const sold = await reservations.reserve({
        variantId: stocked.variantId,
        quantity: 1,
        expiresAt,
      });
      if (!sold.ok) throw new Error("reserve failed");
      await clear();
      await reservations.commit(sold.reservation.id);
      expect(await marked()).toEqual({ [stocked.productId]: "reservation_changed" });

      const due = await reservations.reserve({
        variantId: stocked.variantId,
        quantity: 1,
        expiresAt: new Date(Date.now() + 1_000),
      });
      if (!due.ok) throw new Error("reserve failed");
      await clear();
      await reservations.expireDue(new Date(Date.now() + 5_000));
      expect(await marked()).toEqual({ [stocked.productId]: "reservation_changed" });
    });

    it("a refused reservation marks nothing", async () => {
      const stocked = await world.variant({ onHand: 1 });
      await clear();
      const refused = await on.app.get(ReservationsService).reserve({
        variantId: stocked.variantId,
        quantity: 5,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(refused).toMatchObject({ ok: false });
      expect(await marked()).toEqual({});
    });
  });

  describe("fan-out writers mark every product that uses the changed definition", () => {
    it("brand rename and slug change; a refused delete marks nothing", async () => {
      const { brandId, productIds } = await brandWithProducts(2);
      const other = await world.createProduct();
      await clear();
      await ok(await call("PATCH", `/admin/brands/${brandId}`, { name: { uk: "Інша назва" } }));
      const after = await marked();
      expect(Object.keys(after).sort()).toEqual([...productIds].sort());
      expect(Object.values(after)).toEqual(["brand_changed", "brand_changed"]);
      expect(after[other.id]).toBeUndefined();

      await clear();
      await ok(await call("PATCH", `/admin/brands/${brandId}`, { slug: `brand-${fx.runId}-x` }));
      expect(Object.keys(await marked()).sort()).toEqual([...productIds].sort());

      // The description is not in a document: no mark.
      await clear();
      await ok(await call("PATCH", `/admin/brands/${brandId}`, { description: { uk: "Опис" } }));
      expect(await marked()).toEqual({});

      // A brand in use can not be deleted (RESTRICT), so no product loses it.
      await clear();
      expect((await call("DELETE", `/admin/brands/${brandId}`)).status).toBe(409);
      expect(await marked()).toEqual({});
    });

    it("category rename, activation and move reach the products of the whole subtree", async () => {
      const root = await call<{ id: string }>("POST", "/admin/categories", {
        name: { uk: `Корінь ${fx.runId}` },
      });
      await ok(root, 201);
      const child = await call<{ id: string }>("POST", "/admin/categories", {
        name: { uk: `Дитина ${fx.runId}` },
        parentId: root.body.id,
      });
      await ok(child, 201);
      const inChild = await world.createProduct();
      const inRoot = await world.createProduct();
      await ok(
        await call("PUT", `/admin/products/${inChild.id}/categories`, {
          categories: [{ categoryId: child.body.id }],
        }),
      );
      await ok(
        await call("PUT", `/admin/products/${inRoot.id}/categories`, {
          categories: [{ categoryId: root.body.id }],
        }),
      );
      const both = [inChild.id, inRoot.id].sort();

      await clear();
      await ok(await call("PATCH", `/admin/categories/${root.body.id}`, { name: { uk: "Нове" } }));
      expect(Object.keys(await marked()).sort()).toEqual(both);
      expect(Object.values(await marked())).toEqual(["category_changed", "category_changed"]);

      await clear();
      await ok(await call("PATCH", `/admin/categories/${child.body.id}`, { isActive: false }));
      expect(Object.keys(await marked())).toEqual([inChild.id]);

      await clear();
      await ok(await call("POST", `/admin/categories/${child.body.id}/move`, { parentId: null }));
      expect(Object.keys(await marked())).toEqual([inChild.id]);

      // The description is not in a document: no mark.
      await clear();
      await ok(
        await call("PATCH", `/admin/categories/${root.body.id}`, { description: { uk: "Опис" } }),
      );
      expect(await marked()).toEqual({});

      await ok(await call("PUT", `/admin/products/${inChild.id}/categories`, { categories: [] }));
      await ok(await call("PUT", `/admin/products/${inRoot.id}/categories`, { categories: [] }));
      await ok(await call("DELETE", `/admin/categories/${child.body.id}`), 204);
      await ok(await call("DELETE", `/admin/categories/${root.body.id}`), 204);
    });

    it("an option value label reaches the products whose variants use it", async () => {
      const using = await world.createProduct();
      await ok(
        await call("PUT", `/admin/products/${using.id}/options`, {
          options: [{ optionId: fx.color.id, valueIds: [fx.color.values["red"]] }],
        }),
      );
      const generated = await call("POST", `/admin/products/${using.id}/variants/generate`);
      expect(generated.status, JSON.stringify(generated.body)).toBeLessThan(300);
      await clear();
      await ok(
        await call("PATCH", `/admin/options/${fx.color.id}/values/${fx.color.values["red"]}`, {
          label: { uk: "Червоний" },
        }),
      );
      expect(await marked()).toEqual({ [using.id]: "option_changed" });
    });

    it("an attribute change or an attribute option label reaches the products of every type using it", async () => {
      const product = await world.createProduct();
      const attribute = await pool.query<{ id: string }>(
        "select id from attribute where code = $1",
        [fx.materialAttributeCode],
      );
      const attributeId = attribute.rows[0]?.id ?? "";
      await clear();
      await ok(await call("PATCH", `/admin/attributes/${attributeId}`, { isSearchable: true }));
      const afterFlag = await marked();
      expect(afterFlag[product.id]).toBe("attribute_changed");

      const options = await pool.query<{ id: string }>(
        "select id from attribute_option where attribute_id = $1 and code = 'cotton'",
        [attributeId],
      );
      await clear();
      await ok(
        await call("PATCH", `/admin/attributes/${attributeId}/options/${options.rows[0]?.id}`, {
          label: { uk: "Бавовна" },
        }),
      );
      expect((await marked())[product.id]).toBe("attribute_changed");
    });

    it("an attribute change that reaches no document marks nothing and requests no rebuild, even above the fan-out limit", async () => {
      const product = await world.createProduct();
      const attribute = await pool.query<{ id: string; is_searchable: boolean }>(
        "select id, is_searchable from attribute where code = $1",
        [fx.materialAttributeCode],
      );
      const attributeId = attribute.rows[0]?.id ?? "";
      await clear();
      // isFilterable is an index setting (job 13 applies it in place); the others are not indexed at all.
      for (const body of [
        { isFilterable: true },
        { isFilterable: false },
        { isComparable: true },
        { name: { uk: "Матеріал виробу" } },
      ]) {
        await ok(await callSmall("PATCH", `/admin/attributes/${attributeId}`, body));
      }
      expect(await marked()).toEqual({});
      expect((await pool.query("select * from search_index_state")).rows).toEqual([]);
      // A document change of the same attribute still reaches its products.
      await ok(
        await call("PATCH", `/admin/attributes/${attributeId}`, {
          isSearchable: attribute.rows[0]?.is_searchable !== true,
        }),
      );
      expect((await marked())[product.id]).toBe("attribute_changed");
    });

    it("product type attribute assignments reach the products of the type; option assignments mark nothing", async () => {
      const product = await world.createProduct();
      const attribute = await call<{ id: string }>("POST", "/admin/attributes", {
        code: `fan_${fx.runId}`,
        name: { uk: "Віяло" },
        inputType: "boolean",
      });
      await ok(attribute, 201);
      await clear();
      await ok(
        await call("PUT", `/admin/product-types/${fx.teeTypeId}/attributes/${attribute.body.id}`, {
          level: "product",
        }),
        201,
      );
      expect((await marked())[product.id]).toBe("attribute_changed");

      await clear();
      await ok(
        await call(
          "DELETE",
          `/admin/product-types/${fx.teeTypeId}/attributes/${attribute.body.id}`,
        ),
        204,
      );
      expect((await marked())[product.id]).toBe("attribute_changed");
      await call("DELETE", `/admin/attributes/${attribute.body.id}`);

      // Option values in documents come from the variants, not from the type; the filterable list follows the
      // settings hash. An option still in use can not be removed from the type.
      await clear();
      await ok(
        await call("PUT", `/admin/product-types/${fx.teeTypeId}/options/${fx.foreign.id}`, {}),
        201,
      );
      await ok(
        await call("DELETE", `/admin/product-types/${fx.teeTypeId}/options/${fx.foreign.id}`),
        204,
      );
      expect(await marked()).toEqual({});
    });

    it("above the fan-out limit nothing is marked and a rebuild of every locale is requested", async () => {
      const { brandId } = await brandWithProducts(
        2,
        callSmall,
        new StockWorld(callSmall, pool, fx),
      );
      await clear();
      await pool.query("delete from search_index_state");
      await ok(await callSmall("PATCH", `/admin/brands/${brandId}`, { name: { uk: "Багато" } }));
      expect(await marked()).toEqual({});
      const state = await pool.query<{ locale: string }>(
        "select locale from search_index_state where rebuild_requested_at is not null order by locale",
      );
      expect(state.rows.map((row) => row.locale)).toEqual(["en", "uk"]);
    });
  });

  describe("with SEARCH_ENABLED=false", () => {
    it("no write reaches the search tables", async () => {
      const offWorld = new StockWorld(callOff, pool, fx);
      const stocked = await offWorld.variant({ onHand: 4 });
      await ok(
        await callOff("PATCH", `/admin/products/${stocked.productId}`, {
          title: { uk: "Вимкнено" },
        }),
      );
      const priced = await callOff(
        "PUT",
        `/admin/products/${stocked.productId}/variants/${stocked.variantId}/prices/UAH`,
        { amount: 777 },
      );
      expect(priced.status, JSON.stringify(priced.body)).toBeLessThan(300);
      await offWorld.receive(stocked, 2);
      const held = await off.app.get(ReservationsService).reserve({
        variantId: stocked.variantId,
        quantity: 1,
        expiresAt: new Date(Date.now() + 60_000),
      });
      expect(held.ok).toBe(true);
      const { brandId } = await brandWithProducts(1, callOff, offWorld);
      await ok(await callOff("PATCH", `/admin/brands/${brandId}`, { name: { uk: "Вимк" } }));
      expect(await marked()).toEqual({});
      expect((await pool.query("select * from search_index_state")).rows).toEqual([]);
    });
  });
});

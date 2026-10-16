import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import {
  caller,
  createCatalogFixture,
  newRunId,
  type Call,
  type CatalogFixture,
} from "../../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { ensureMigrated } from "../../../test/migrate.js";
import type { ProductDetailResponse } from "../products/products.schemas.js";
import type { GenerateVariantsResponse, VariantResponse } from "./variants.schemas.js";

describe("variant stock flags (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let digitalTypeId = "";
  let counter = 0;

  async function createProduct(typeId: string): Promise<ProductDetailResponse> {
    counter += 1;
    const result = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: typeId,
      title: { uk: `Прапори ${fx.runId} ${counter}`, en: `Flags ${fx.runId} ${counter}` },
      attributes: typeId === fx.teeTypeId ? { [fx.materialAttributeCode]: "cotton" } : {},
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  const variantPath = (productId: string, variantId = "") =>
    `/admin/products/${productId}/variants${variantId === "" ? "" : `/${variantId}`}`;

  async function flagsInDatabase(variantId: string) {
    const result = await pool.query(
      "select track_inventory, allow_backorder from variant where id = $1",
      [variantId],
    );
    return result.rows[0] as { track_inventory: boolean; allow_backorder: boolean };
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
    const digital = await call<{ id: string }>("POST", "/admin/product-types", {
      code: `digital_${newRunId()}`,
      name: { uk: "Цифровий" },
      requiresShipping: false,
    });
    expect(digital.status, JSON.stringify(digital.body)).toBe(201);
    digitalTypeId = digital.body.id;
    for (const option of [fx.color, fx.size]) {
      const allowed = await call(
        "PUT",
        `/admin/product-types/${digitalTypeId}/options/${option.id}`,
        {},
      );
      expect(allowed.status, JSON.stringify(allowed.body)).toBeLessThan(300);
    }
  });

  afterAll(async () => {
    await running.app.close();
    await pool.query("delete from product where product_type_id = $1", [digitalTypeId]);
    await pool.query("delete from product_type where id = $1", [digitalTypeId]);
    await fx.cleanup(pool);
    await pool.end();
  });

  describe("defaults", () => {
    it("shows both flags in every admin variant response; a shipped product starts tracked, no backorder", async () => {
      const product = await createProduct(fx.teeTypeId);
      expect(product.variants[0]).toMatchObject({ trackInventory: true, allowBackorder: false });
      const single = await call<VariantResponse>(
        "GET",
        variantPath(product.id, product.variants[0]?.id),
      );
      expect(single.body).toMatchObject({ trackInventory: true, allowBackorder: false });
      const listed = await call<{ items: VariantResponse[] }>("GET", variantPath(product.id));
      expect(listed.body.items[0]).toMatchObject({ trackInventory: true, allowBackorder: false });
    });

    it("starts the default variant of a digital product type untracked", async () => {
      const product = await createProduct(digitalTypeId);
      const variant = product.variants[0];
      expect(variant).toMatchObject({ trackInventory: false, allowBackorder: false });
      expect(await flagsInDatabase(variant?.id ?? "")).toEqual({
        track_inventory: false,
        allow_backorder: false,
      });
    });

    it("starts generated variants of a digital product type untracked, and shipped ones tracked", async () => {
      const digital = await createProduct(digitalTypeId);
      const put = await call<ProductDetailResponse>(
        "PUT",
        `/admin/products/${digital.id}/options`,
        {
          options: [
            { optionId: fx.color.id, valueIds: [fx.color.values["red"], fx.color.values["blue"]] },
          ],
        },
      );
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.variants).toHaveLength(2);
      for (const variant of put.body.variants) {
        expect(variant).toMatchObject({ trackInventory: false, allowBackorder: false });
      }
      const generated = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(digital.id)}/generate`,
      );
      expect(generated.status).toBe(200);

      const shipped = await createProduct(fx.teeTypeId);
      const shippedPut = await call<ProductDetailResponse>(
        "PUT",
        `/admin/products/${shipped.id}/options`,
        {
          options: [
            { optionId: fx.color.id, valueIds: [fx.color.values["red"], fx.color.values["blue"]] },
          ],
        },
      );
      for (const variant of shippedPut.body.variants) {
        expect(variant).toMatchObject({ trackInventory: true, allowBackorder: false });
      }
    });

    it("starts a hand-made variant of a digital product untracked unless the body says otherwise", async () => {
      const digital = await createProduct(digitalTypeId);
      const put = await call<ProductDetailResponse>(
        "PUT",
        `/admin/products/${digital.id}/options`,
        {
          options: [
            { optionId: fx.color.id, valueIds: [fx.color.values["red"], fx.color.values["blue"]] },
          ],
        },
      );
      const blue = put.body.variants.find((variant) => variant.optionSignature.endsWith("=blue"));
      expect((await call("DELETE", variantPath(digital.id, blue?.id))).status).toBe(204);
      const created = await call<VariantResponse>("POST", variantPath(digital.id), {
        optionValueIds: [fx.color.values["blue"]],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({ trackInventory: false, allowBackorder: false });
    });
  });

  describe("POST /admin/products/:id/variants", () => {
    it("accepts both flags and stores them", async () => {
      const product = await createProduct(fx.teeTypeId);
      const put = await call<ProductDetailResponse>(
        "PUT",
        `/admin/products/${product.id}/options`,
        {
          options: [
            { optionId: fx.color.id, valueIds: [fx.color.values["red"], fx.color.values["blue"]] },
          ],
        },
      );
      const blue = put.body.variants.find((variant) => variant.optionSignature.endsWith("=blue"));
      expect((await call("DELETE", variantPath(product.id, blue?.id))).status).toBe(204);
      const created = await call<VariantResponse>("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values["blue"]],
        trackInventory: false,
        allowBackorder: true,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({ trackInventory: false, allowBackorder: true });
      expect(await flagsInDatabase(created.body.id)).toEqual({
        track_inventory: false,
        allow_backorder: true,
      });
    });

    it("rejects flags that are not booleans", async () => {
      const product = await createProduct(fx.teeTypeId);
      const result = await call<ProblemBody>("POST", variantPath(product.id), {
        optionValueIds: [],
        trackInventory: "yes",
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toContainEqual(
        expect.objectContaining({ path: "trackInventory", code: "invalid_type" }),
      );
    });
  });

  describe("PATCH /admin/products/:id/variants/:variantId", () => {
    it("changes the flags, one at a time or together, and nothing else", async () => {
      const product = await createProduct(fx.teeTypeId);
      const variant = product.variants[0];
      const path = variantPath(product.id, variant?.id);

      const first = await call<VariantResponse>("PATCH", path, { allowBackorder: true });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({
        trackInventory: true,
        allowBackorder: true,
        sku: variant?.sku,
        isActive: true,
      });

      const second = await call<VariantResponse>("PATCH", path, {
        trackInventory: false,
        allowBackorder: false,
      });
      expect(second.body).toMatchObject({ trackInventory: false, allowBackorder: false });
      expect(await flagsInDatabase(variant?.id ?? "")).toEqual({
        track_inventory: false,
        allow_backorder: false,
      });

      const fromDetail = await call<ProductDetailResponse>("GET", `/admin/products/${product.id}`);
      expect(fromDetail.body.variants[0]).toMatchObject({
        trackInventory: false,
        allowBackorder: false,
      });
    });

    it("also works on a published product", async () => {
      const product = await createProduct(fx.teeTypeId);
      await pool.query(
        "insert into price (variant_id, currency, amount) select id, 'UAH', 100 from variant where product_id = $1",
        [product.id],
      );
      expect((await call("POST", `/admin/products/${product.id}/publish`)).status).toBe(200);
      const result = await call<VariantResponse>(
        "PATCH",
        variantPath(product.id, product.variants[0]?.id),
        { allowBackorder: true },
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.allowBackorder).toBe(true);
    });

    it("rejects flags that are not booleans and null", async () => {
      const product = await createProduct(fx.teeTypeId);
      const path = variantPath(product.id, product.variants[0]?.id);
      for (const body of [
        { trackInventory: "yes" },
        { allowBackorder: 1 },
        { trackInventory: null },
      ]) {
        const result = await call<ProblemBody>("PATCH", path, body);
        expect(result.status, JSON.stringify(body)).toBe(400);
      }
    });
  });
});

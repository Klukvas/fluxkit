import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "../../../common/pagination.js";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import {
  caller,
  createCatalogFixture,
  expectVariantInvariants,
  expectWaitsForProductLock,
  type CatalogFixture,
  type Call,
  type OptionFixture,
} from "../../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import type { ProductDetailResponse } from "../products/products.schemas.js";
import type { GenerateVariantsResponse, VariantResponse } from "./variants.schemas.js";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin variants API (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let counter = 0;

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  function sel(option: OptionFixture, codes: readonly string[]) {
    return {
      optionId: option.id,
      valueIds: codes.map((code) => {
        const id = option.values[code];
        if (id === undefined) {
          throw new Error(`Unknown value code ${code} of ${option.code}`);
        }
        return id;
      }),
    };
  }

  async function createProduct(
    typeId = fx.teeTypeId,
    attributes: Record<string, unknown> = {},
  ): Promise<ProductDetailResponse> {
    counter += 1;
    const result = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: typeId,
      title: { uk: `Футболка ${fx.runId} ${counter}`, en: `Tee ${fx.runId} ${counter}` },
      attributes,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  async function putOptions(
    productId: string,
    ...selections: ReturnType<typeof sel>[]
  ): Promise<ProductDetailResponse> {
    const result = await call<ProductDetailResponse>(
      "PUT",
      `/admin/products/${productId}/options`,
      {
        options: selections,
      },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  }

  /** A draft product with color (red, blue, green) x size (s, m) = 6 variants. */
  async function sixVariants(): Promise<ProductDetailResponse> {
    const product = await createProduct(fx.teeTypeId, { [fx.materialAttributeCode]: "cotton" });
    return putOptions(
      product.id,
      sel(fx.color, ["red", "blue", "green"]),
      sel(fx.size, ["s", "m"]),
    );
  }

  async function setStatus(productId: string, action: "publish" | "archive" | "unpublish") {
    const result = await call("POST", `/admin/products/${productId}/${action}`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }

  async function getProduct(id: string): Promise<ProductDetailResponse> {
    const result = await call<ProductDetailResponse>("GET", `/admin/products/${id}`);
    expect(result.status).toBe(200);
    return result.body;
  }

  function variantOf(product: ProductDetailResponse, color: string, size: string): VariantResponse {
    const found = product.variants.find(
      (variant) => variant.optionSignature === `${fx.color.code}=${color};${fx.size.code}=${size}`,
    );
    if (found === undefined) {
      throw new Error(`No variant ${color}/${size}`);
    }
    return found;
  }

  const variantPath = (productId: string, variantId = "") =>
    `/admin/products/${productId}/variants${variantId === "" ? "" : `/${variantId}`}`;

  async function variantRows(productId: string) {
    const result = await pool.query(
      "select id, sku, is_default, is_active from variant where product_id = $1 order by sku",
      [productId],
    );
    return result.rows;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    call = caller(() => running.baseUrl);
    fx = await createCatalogFixture(call);
  });

  afterAll(async () => {
    await running.app.close();
    await fx.cleanup(pool);
    await pool.end();
  });

  describe("GET /admin/products/:id/variants", () => {
    it("lists the variants of a product with their option values, paginated in a stable order", async () => {
      const product = await sixVariants();
      const all = await call<Page<VariantResponse>>("GET", variantPath(product.id));
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ total: 6, limit: 50, offset: 0 });
      expect(all.body.items.map((item) => item.id)).toEqual(
        product.variants.map((variant) => variant.id),
      );
      expect(all.body.items[0]?.optionValues).toHaveLength(2);

      const second = await call<Page<VariantResponse>>(
        "GET",
        `${variantPath(product.id)}?limit=2&offset=2`,
      );
      expect(second.body.items.map((item) => item.id)).toEqual(
        product.variants.slice(2, 4).map((variant) => variant.id),
      );
      expect(second.body).toMatchObject({ total: 6, limit: 2, offset: 2 });
    });

    it("answers 404 for an unknown product and 400 for bad ids and paging", async () => {
      expect((await call("GET", variantPath(MISSING_ID))).status).toBe(404);
      expect((await call("GET", "/admin/products/not-a-uuid/variants")).status).toBe(400);
      const product = await createProduct();
      expect((await call("GET", `${variantPath(product.id)}?limit=0`)).status).toBe(400);
    });
  });

  describe("GET /admin/products/:id/variants/:variantId", () => {
    it("returns one variant", async () => {
      const product = await sixVariants();
      const expected = variantOf(product, "blue", "m");
      const result = await call<VariantResponse>("GET", variantPath(product.id, expected.id));
      expect(result.status).toBe(200);
      expect(result.body).toEqual(expected);
    });

    it("answers 404 for an unknown variant and for a variant of another product", async () => {
      const product = await sixVariants();
      const other = await createProduct();
      const otherVariant = other.variants[0];
      expect((await call("GET", variantPath(product.id, MISSING_ID))).status).toBe(404);
      const crossed = await call("GET", variantPath(product.id, otherVariant?.id));
      expect(crossed.status).toBe(404);
      expect(problem(crossed).code).toBe("not_found");
      expect((await call("GET", variantPath(MISSING_ID, otherVariant?.id))).status).toBe(404);
      expect((await call("GET", variantPath(product.id, "not-a-uuid"))).status).toBe(400);
    });
  });

  describe("POST /admin/products/:id/variants/generate", () => {
    it("creates nothing for a simple product", async () => {
      const product = await createProduct();
      const result = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(product.id)}/generate`,
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ created: 0, skipped: 1 });
      expect(result.body.variants).toHaveLength(1);
    });

    it("creates the missing variants of a live product inactive when the type requires a variant attribute", async () => {
      const draft = await createProduct(fx.strictTypeId);
      const product = await putOptions(draft.id, sel(fx.color, ["red", "blue"]));
      for (const variant of product.variants) {
        const filled = await call("PATCH", variantPath(product.id, variant.id), {
          attributes: { [fx.batchAttributeCode]: "B-1" },
        });
        expect(filled.status).toBe(200);
      }
      await setStatus(product.id, "publish");
      const blue = product.variants.find((variant) => variant.optionSignature.endsWith("=blue"));
      await pool.query("delete from variant where id = $1", [blue?.id]);

      const result = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(product.id)}/generate`,
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.created).toBe(1);
      const recreated = result.body.variants.filter((variant) =>
        variant.optionSignature.endsWith("=blue"),
      );
      expect(recreated).toHaveLength(1);
      expect(recreated[0]).toMatchObject({ isActive: false, attributes: {} });
      expect(result.body.variants.filter((variant) => variant.isActive)).toHaveLength(1);
    });

    it("recreates missing combinations (2 x 3 = 6) and is idempotent", async () => {
      const product = await sixVariants();
      const toDelete = [variantOf(product, "red", "m"), variantOf(product, "green", "s")];
      for (const variant of toDelete) {
        expect((await call("DELETE", variantPath(product.id, variant.id))).status).toBe(204);
      }
      const first = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(product.id)}/generate`,
      );
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ created: 2, skipped: 4 });
      expect(first.body.variants).toHaveLength(6);
      expect(first.body.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
      expect(variantOf(await getProduct(product.id), "red", "m")).toMatchObject({
        isDefault: false,
        isActive: true,
      });

      const second = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(product.id)}/generate`,
      );
      expect(second.body).toMatchObject({ created: 0, skipped: 6 });
      expect(second.body.variants.map((variant) => variant.id)).toEqual(
        first.body.variants.map((variant) => variant.id),
      );
      await expectVariantInvariants(pool, product.id);
    });

    it("generates the full set for options chosen without variants, the first one being the default", async () => {
      const product = await createProduct();
      await pool.query("delete from variant where product_id = $1", [product.id]);
      await pool.query(
        "insert into product_option (product_id, option_id, position) values ($1, $2, 0), ($1, $3, 1)",
        [product.id, fx.color.id, fx.size.id],
      );
      for (const [option, codes] of [
        [fx.color, ["red", "blue", "green"]],
        [fx.size, ["s", "m"]],
      ] as const) {
        for (const [position, code] of codes.entries()) {
          await pool.query(
            "insert into product_option_value (product_id, option_id, option_value_id, position) values ($1, $2, $3, $4)",
            [product.id, option.id, option.values[code], position],
          );
        }
      }
      const result = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(product.id)}/generate`,
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body).toMatchObject({ created: 6, skipped: 0 });
      expect(result.body.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
      expect(new Set(result.body.variants.map((variant) => variant.sku)).size).toBe(6);
      await expectVariantInvariants(pool, product.id);
    });

    it("works on an active product (new combinations only) and on an archived one", async () => {
      const product = await sixVariants();
      await setStatus(product.id, "publish");
      const green = variantOf(product, "green", "m");
      await pool.query("delete from variant where id = $1", [green.id]);
      const active = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(product.id)}/generate`,
      );
      expect(active.body).toMatchObject({ created: 1, skipped: 5 });
      await setStatus(product.id, "archive");
      const archived = await call<GenerateVariantsResponse>(
        "POST",
        `${variantPath(product.id)}/generate`,
      );
      expect(archived.body).toMatchObject({ created: 0, skipped: 6 });
      expect((await getProduct(product.id)).status).toBe("archived");
      await expectVariantInvariants(pool, product.id);
    });

    it("refuses more than 250 new variants and more than 250 in total, creating nothing", async () => {
      const big = await createProduct();
      await pool.query("delete from variant where product_id = $1", [big.id]);
      await pool.query(
        "insert into product_option (product_id, option_id, position) values ($1, $2, 0), ($1, $3, 1)",
        [big.id, fx.biga.id, fx.bigb.id],
      );
      const seed = async (productId: string, option: OptionFixture, codes: readonly string[]) => {
        for (const [position, code] of codes.entries()) {
          await pool.query(
            "insert into product_option_value (product_id, option_id, option_value_id, position) values ($1, $2, $3, $4)",
            [productId, option.id, option.values[code], position],
          );
        }
      };
      await seed(big.id, fx.biga, Object.keys(fx.biga.values));
      await seed(big.id, fx.bigb, Object.keys(fx.bigb.values));
      const tooMany = await call("POST", `${variantPath(big.id)}/generate`);
      expect(tooMany.status).toBe(400);
      expect(problem(tooMany).errors).toEqual([
        expect.objectContaining({ path: "variants", code: "too_many_new_variants" }),
      ]);
      expect(await variantRows(big.id)).toEqual([]);

      const product = await createProduct();
      await putOptions(
        product.id,
        sel(
          fx.biga,
          Array.from({ length: 25 }, (_, index) => `a${index + 1}`),
        ),
        sel(
          fx.bigb,
          Array.from({ length: 10 }, (_, index) => `b${index + 1}`),
        ),
      );
      await pool.query(
        "insert into product_option_value (product_id, option_id, option_value_id, position) values ($1, $2, $3, 25)",
        [product.id, fx.biga.id, fx.biga.values.a26],
      );
      const total = await call("POST", `${variantPath(product.id)}/generate`);
      expect(total.status).toBe(400);
      expect(problem(total).errors).toEqual([
        expect.objectContaining({ path: "variants", code: "too_many_variants_total" }),
      ]);
      expect(await variantRows(product.id)).toHaveLength(250);
    });

    it("does not create duplicates when called concurrently (serialized by the product row lock)", async () => {
      const product = await createProduct();
      await pool.query("delete from variant where product_id = $1", [product.id]);
      await pool.query(
        "insert into product_option (product_id, option_id, position) values ($1, $2, 0), ($1, $3, 1)",
        [product.id, fx.color.id, fx.size.id],
      );
      for (const [option, codes] of [
        [fx.color, ["red", "blue", "green"]],
        [fx.size, ["s", "m", "l"]],
      ] as const) {
        for (const [position, code] of codes.entries()) {
          await pool.query(
            "insert into product_option_value (product_id, option_id, option_value_id, position) values ($1, $2, $3, $4)",
            [product.id, option.id, option.values[code], position],
          );
        }
      }
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          call<GenerateVariantsResponse>("POST", `${variantPath(product.id)}/generate`),
        ),
      );
      expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(results.reduce((sum, result) => sum + result.body.created, 0)).toBe(9);
      expect(await variantRows(product.id)).toHaveLength(9);
      await expectVariantInvariants(pool, product.id);
    });

    it("answers 404 for an unknown product", async () => {
      expect((await call("POST", `${variantPath(MISSING_ID)}/generate`)).status).toBe(404);
    });
  });

  describe("POST /admin/products/:id/variants", () => {
    /** A draft with 6 variants where the red/m combination was removed, so it can be created by hand. */
    async function withFreeSlot() {
      const product = await sixVariants();
      const removed = variantOf(product, "red", "m");
      expect((await call("DELETE", variantPath(product.id, removed.id))).status).toBe(204);
      return { product, removed };
    }

    it("creates a variant from one value of every option, proposing the SKU", async () => {
      const { product } = await withFreeSlot();
      const result = await call<VariantResponse>("POST", variantPath(product.id), {
        optionValueIds: [fx.size.values.m, fx.color.values.red],
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.headers.get("location")).toBe(variantPath(product.id, result.body.id));
      expect(result.body).toMatchObject({
        sku: `${product.slug}-red-m`.toUpperCase(),
        optionSignature: `${fx.color.code}=red;${fx.size.code}=m`,
        isDefault: false,
        isActive: true,
        barcode: null,
        attributes: {},
      });
      expect(result.body.optionValues.map((value) => value.valueCode)).toEqual(["red", "m"]);
      expect((await call<Page<VariantResponse>>("GET", variantPath(product.id))).body.total).toBe(
        6,
      );
      await expectVariantInvariants(pool, product.id);
    });

    it("takes sku (normalized), barcode (trimmed), variant attributes and isActive", async () => {
      const { product } = await withFreeSlot();
      const result = await call<VariantResponse>("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red, fx.size.values.m],
        sku: `  hand-${fx.runId}  `,
        barcode: "  4820000000012 ",
        attributes: { [fx.supplierAttributeCode]: "ACME" },
        isActive: false,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body).toMatchObject({
        sku: `HAND-${fx.runId}`.toUpperCase(),
        barcode: "4820000000012",
        attributes: { [fx.supplierAttributeCode]: "ACME" },
        isActive: false,
      });
    });

    it("builds a variant of a simple product only when its single slot is free", async () => {
      const product = await createProduct();
      const taken = await call("POST", variantPath(product.id), { optionValueIds: [] });
      expect(taken.status).toBe(409);
      expect(problem(taken)).toMatchObject({
        code: "conflict",
        constraint: "variant_product_id_option_signature_key",
      });
      const notChosen = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red],
      });
      expect(notChosen.status).toBe(400);
      expect(problem(notChosen).errors).toEqual([
        expect.objectContaining({ path: "optionValueIds.0", code: "invalid_reference" }),
      ]);
    });

    it("refuses a product that is not a draft", async () => {
      const { product } = await withFreeSlot();
      await setStatus(product.id, "publish");
      const result = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red, fx.size.values.m],
      });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({ code: "rule_violation", rule: "product_not_draft" });
      await setStatus(product.id, "archive");
      const archived = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red, fx.size.values.m],
      });
      expect(archived.status).toBe(409);
      expect(problem(archived).rule).toBe("product_not_draft");
    });

    it("requires exactly one value for every product option", async () => {
      const { product } = await withFreeSlot();
      const missing = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red],
      });
      expect(missing.status).toBe(400);
      expect(problem(missing).errors).toEqual([
        expect.objectContaining({ path: "optionValueIds", code: "missing_option_value" }),
      ]);
      const none = await call("POST", variantPath(product.id), { optionValueIds: [] });
      expect(none.status).toBe(400);
      expect(problem(none).errors).toHaveLength(2);
      const twice = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red, fx.color.values.blue, fx.size.values.m],
      });
      expect(twice.status).toBe(400);
      expect(problem(twice).errors).toEqual([
        expect.objectContaining({ path: "optionValueIds", code: "duplicate_option_value" }),
      ]);
    });

    it("refuses a value the product did not choose, and unknown values", async () => {
      const { product } = await withFreeSlot();
      const unchosen = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red, fx.size.values.l],
      });
      expect(unchosen.status).toBe(400);
      expect(problem(unchosen).errors).toEqual([
        expect.objectContaining({ path: "optionValueIds.1", code: "invalid_reference" }),
      ]);
      const unknown = await call("POST", variantPath(product.id), {
        optionValueIds: [MISSING_ID, fx.size.values.m],
      });
      expect(unknown.status).toBe(400);
    });

    it("answers 409 for an existing combination and for a taken SKU", async () => {
      const { product } = await withFreeSlot();
      const combination = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.blue, fx.size.values.m],
      });
      expect(combination.status).toBe(409);
      expect(problem(combination)).toMatchObject({
        code: "conflict",
        constraint: "variant_product_id_option_signature_key",
      });

      const takenSku = variantOf(await getProduct(product.id), "blue", "s").sku;
      const duplicate = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.color.values.red, fx.size.values.m],
        sku: takenSku.toLowerCase(),
      });
      expect(duplicate.status).toBe(409);
      expect(problem(duplicate)).toMatchObject({
        code: "conflict",
        constraint: "variant_sku_key",
        field: "sku",
      });
      expect(await variantRows(product.id)).toHaveLength(5);
    });

    it("validates sku, barcode, attributes and the body shape", async () => {
      const { product } = await withFreeSlot();
      const base = { optionValueIds: [fx.color.values.red, fx.size.values.m] };
      const cases: [Record<string, unknown>, string, string][] = [
        [{ sku: "bad sku!" }, "sku", "invalid_format"],
        [{ sku: "   " }, "sku", "empty"],
        [{ sku: "A".repeat(65) }, "sku", "too_long"],
        [{ barcode: "9".repeat(65) }, "barcode", "too_big"],
        [{ attributes: { nope: 1 } }, "attributes.nope", "unknown_attribute"],
        [
          { attributes: { [fx.supplierAttributeCode]: 5 } },
          `attributes.${fx.supplierAttributeCode}`,
          "invalid_type",
        ],
        [{ isDefault: true }, "isDefault", "unknown_field"],
        [{ isActive: "yes" }, "isActive", "invalid_type"],
      ];
      for (const [extra, path, code] of cases) {
        const result = await call("POST", variantPath(product.id), { ...base, ...extra });
        expect(result.status, JSON.stringify(extra)).toBe(400);
        expect(problem(result).errors, JSON.stringify(extra)).toContainEqual(
          expect.objectContaining({ path, code }),
        );
      }
      const missingList = await call("POST", variantPath(product.id), {});
      expect(missingList.status).toBe(400);
      expect(problem(missingList).errors?.[0]).toMatchObject({
        path: "optionValueIds",
        code: "required",
      });
      expect(await variantRows(product.id)).toHaveLength(5);
    });

    it.each([
      ["NUL", "\u0000"],
      ["a lone surrogate", "\ud800"],
    ])("answers 400, not 500, for %s in sku and barcode", async (_name, bad) => {
      const { product } = await withFreeSlot();
      const base = { optionValueIds: [fx.color.values.red, fx.size.values.m] };
      const sku = await call("POST", variantPath(product.id), { ...base, sku: `AB${bad}C` });
      expect(sku.status, JSON.stringify(sku.body)).toBe(400);
      expect(problem(sku).errors).toContainEqual(
        expect.objectContaining({ path: "sku", code: "invalid_format" }),
      );
      const barcode = await call("POST", variantPath(product.id), {
        ...base,
        barcode: `48${bad}20`,
      });
      expect(barcode.status, JSON.stringify(barcode.body)).toBe(400);
      expect(problem(barcode).errors).toContainEqual(expect.objectContaining({ path: "barcode" }));
      expect(await variantRows(product.id)).toHaveLength(5);
    });

    it("refuses the 251st variant", async () => {
      const product = await createProduct();
      await putOptions(
        product.id,
        sel(
          fx.biga,
          Array.from({ length: 25 }, (_, index) => `a${index + 1}`),
        ),
        sel(
          fx.bigb,
          Array.from({ length: 10 }, (_, index) => `b${index + 1}`),
        ),
      );
      const result = await call("POST", variantPath(product.id), {
        optionValueIds: [fx.biga.values.a1, fx.bigb.values.b1],
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "variants", code: "too_many_variants_total" }),
      ]);
    });

    it("answers 404 for an unknown product", async () => {
      const result = await call("POST", variantPath(MISSING_ID), { optionValueIds: [] });
      expect(result.status).toBe(404);
    });

    it("serializes concurrent creates on one product", async () => {
      const first = await sixVariants();
      const removed = [variantOf(first, "red", "m"), variantOf(first, "blue", "m")];
      for (const variant of removed) {
        expect((await call("DELETE", variantPath(first.id, variant.id))).status).toBe(204);
      }
      const results = await Promise.all([
        call<VariantResponse>("POST", variantPath(first.id), {
          optionValueIds: [fx.color.values.red, fx.size.values.m],
        }),
        call<VariantResponse>("POST", variantPath(first.id), {
          optionValueIds: [fx.color.values.blue, fx.size.values.m],
        }),
      ]);
      expect(results.map((result) => result.status)).toEqual([201, 201]);
      expect(await variantRows(first.id)).toHaveLength(6);
      await expectVariantInvariants(pool, first.id);
    });
  });

  describe("PATCH /admin/products/:id/variants/:variantId", () => {
    it("changes sku, barcode, attributes, isActive and position, and nothing else", async () => {
      const product = await sixVariants();
      const target = variantOf(product, "blue", "s");
      const result = await call<VariantResponse>("PATCH", variantPath(product.id, target.id), {
        sku: ` patched-${fx.runId} `,
        barcode: " 123 ",
        attributes: { [fx.supplierAttributeCode]: "ACME" },
        isActive: false,
        position: 40,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body).toEqual({
        ...target,
        sku: `PATCHED-${fx.runId}`.toUpperCase(),
        barcode: "123",
        attributes: { [fx.supplierAttributeCode]: "ACME" },
        isActive: false,
        position: 40,
        updatedAt: expect.any(String),
      });
      expect(Date.parse(result.body.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(target.updatedAt),
      );
      expect(await getProduct(product.id)).toMatchObject({
        variants: expect.arrayContaining([
          expect.objectContaining({ id: target.id, position: 40 }),
        ]),
      });
    });

    it("clears the barcode with null or an empty string and accepts an empty body", async () => {
      const product = await sixVariants();
      const target = variantOf(product, "blue", "s");
      await call("PATCH", variantPath(product.id, target.id), { barcode: "555" });
      const cleared = await call<VariantResponse>("PATCH", variantPath(product.id, target.id), {
        barcode: null,
      });
      expect(cleared.body.barcode).toBeNull();
      await call("PATCH", variantPath(product.id, target.id), { barcode: "555" });
      const blank = await call<VariantResponse>("PATCH", variantPath(product.id, target.id), {
        barcode: "  ",
      });
      expect(blank.body.barcode).toBeNull();
      const empty = await call<VariantResponse>("PATCH", variantPath(product.id, target.id), {});
      expect(empty.status).toBe(200);
      expect(empty.body.id).toBe(target.id);
    });

    it("keeps option values immutable", async () => {
      const product = await sixVariants();
      const target = variantOf(product, "blue", "s");
      for (const body of [
        { optionValueIds: [fx.color.values.red, fx.size.values.m] },
        { optionSignature: "x" },
        { optionValues: [] },
      ]) {
        const result = await call("PATCH", variantPath(product.id, target.id), body);
        expect(result.status).toBe(400);
        expect(problem(result).errors?.[0]?.code).toBe("unknown_field");
      }
      expect((await call<VariantResponse>("GET", variantPath(product.id, target.id))).body).toEqual(
        target,
      );
    });

    it("answers 409 for a taken SKU and 400 for an invalid one or bad attributes", async () => {
      const product = await sixVariants();
      const target = variantOf(product, "blue", "s");
      const other = variantOf(product, "red", "s");
      const duplicate = await call("PATCH", variantPath(product.id, target.id), { sku: other.sku });
      expect(duplicate.status).toBe(409);
      expect(problem(duplicate)).toMatchObject({ code: "conflict", constraint: "variant_sku_key" });
      const invalid = await call("PATCH", variantPath(product.id, target.id), { sku: "no good" });
      expect(invalid.status).toBe(400);
      expect(problem(invalid).errors).toEqual([{ path: "sku", code: "invalid_format" }]);
      const attributes = await call("PATCH", variantPath(product.id, target.id), {
        attributes: { unknown: "x" },
      });
      expect(attributes.status).toBe(400);
      expect(problem(attributes).errors).toEqual([
        { path: "attributes.unknown", code: "unknown_attribute" },
      ]);
      const position = await call("PATCH", variantPath(product.id, target.id), { position: -1 });
      expect(position.status).toBe(400);
      expect(
        (await call<VariantResponse>("GET", variantPath(product.id, target.id))).body.sku,
      ).toBe(target.sku);
    });

    it("switches the default: the old default is unset in the same transaction", async () => {
      const product = await sixVariants();
      const oldDefault = product.variants.find((variant) => variant.isDefault);
      const target = variantOf(product, "green", "m");
      expect(oldDefault?.id).not.toBe(target.id);
      const result = await call<VariantResponse>("PATCH", variantPath(product.id, target.id), {
        isDefault: true,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.isDefault).toBe(true);
      const after = await getProduct(product.id);
      expect(
        after.variants.filter((variant) => variant.isDefault).map((variant) => variant.id),
      ).toEqual([target.id]);
      expect(after.variants.find((variant) => variant.id === oldDefault?.id)?.isDefault).toBe(
        false,
      );
      await expectVariantInvariants(pool, product.id);
    });

    it("treats isDefault true on the default and isDefault false on a non-default as no-ops", async () => {
      const product = await sixVariants();
      const current = product.variants.find((variant) => variant.isDefault);
      const other = product.variants.find((variant) => !variant.isDefault);
      const same = await call<VariantResponse>("PATCH", variantPath(product.id, current?.id), {
        isDefault: true,
      });
      expect(same.status).toBe(200);
      expect(same.body.isDefault).toBe(true);
      const unset = await call<VariantResponse>("PATCH", variantPath(product.id, other?.id), {
        isDefault: false,
      });
      expect(unset.status).toBe(200);
      expect(unset.body.isDefault).toBe(false);
      await expectVariantInvariants(pool, product.id);
    });

    it("refuses to unset the only default variant", async () => {
      const product = await sixVariants();
      const current = product.variants.find((variant) => variant.isDefault);
      const result = await call("PATCH", variantPath(product.id, current?.id), {
        isDefault: false,
      });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({ code: "rule_violation", rule: "no_default_variant" });
      await expectVariantInvariants(pool, product.id);
    });

    it("on an active product: keeps an active default and at least one active variant", async () => {
      const product = await sixVariants();
      await setStatus(product.id, "publish");
      const current = product.variants.find((variant) => variant.isDefault);
      const other = variantOf(product, "blue", "m");

      const deactivateDefault = await call("PATCH", variantPath(product.id, current?.id), {
        isActive: false,
      });
      expect(deactivateDefault.status).toBe(409);
      expect(problem(deactivateDefault)).toMatchObject({
        code: "rule_violation",
        rule: "default_variant_inactive",
      });

      const deactivateOther = await call<VariantResponse>(
        "PATCH",
        variantPath(product.id, other.id),
        {
          isActive: false,
        },
      );
      expect(deactivateOther.status).toBe(200);
      expect(deactivateOther.body.isActive).toBe(false);

      const inactiveAsDefault = await call("PATCH", variantPath(product.id, other.id), {
        isDefault: true,
      });
      expect(inactiveAsDefault.status).toBe(409);
      expect(problem(inactiveAsDefault).rule).toBe("default_variant_inactive");

      const moved = await call<VariantResponse>(
        "PATCH",
        variantPath(product.id, variantOf(product, "red", "m").id),
        { isDefault: true },
      );
      expect(moved.status).toBe(200);
      await expectVariantInvariants(pool, product.id);
    });

    it("on a draft lets the default be switched off (publish checks it later)", async () => {
      const product = await sixVariants();
      const current = product.variants.find((variant) => variant.isDefault);
      const result = await call<VariantResponse>("PATCH", variantPath(product.id, current?.id), {
        isActive: false,
      });
      expect(result.status).toBe(200);
      const publish = await call("POST", `/admin/products/${product.id}/publish`);
      expect(publish.status).toBe(400);
      expect(problem(publish).errors).toContainEqual(
        expect.objectContaining({ code: "default_variant_inactive" }),
      );
    });

    it("validates variant attributes leniently on a draft and strictly on an active product", async () => {
      const draft = await createProduct(fx.strictTypeId);
      const defaultVariant = draft.variants[0];
      const lenient = await call("PATCH", variantPath(draft.id, defaultVariant?.id), {
        attributes: {},
      });
      expect(lenient.status).toBe(200);
      const filled = await call("PATCH", variantPath(draft.id, defaultVariant?.id), {
        attributes: { [fx.batchAttributeCode]: "B-1" },
      });
      expect(filled.status).toBe(200);
      await setStatus(draft.id, "publish");
      const strict = await call("PATCH", variantPath(draft.id, defaultVariant?.id), {
        attributes: {},
      });
      expect(strict.status).toBe(400);
      expect(problem(strict).errors).toEqual([
        { path: `attributes.${fx.batchAttributeCode}`, code: "required" },
      ]);
    });

    it.each([
      ["NUL", "\u0000"],
      ["a lone surrogate", "\ud800"],
    ])("answers 400, not 500, for %s in sku and barcode", async (_name, bad) => {
      const product = await createProduct();
      const path = variantPath(product.id, product.variants[0]?.id);
      const barcode = await call("PATCH", path, { barcode: `48${bad}20` });
      expect(barcode.status, JSON.stringify(barcode.body)).toBe(400);
      expect(problem(barcode).errors).toContainEqual(expect.objectContaining({ path: "barcode" }));
      const sku = await call("PATCH", path, { sku: `AB${bad}C` });
      expect(sku.status, JSON.stringify(sku.body)).toBe(400);
      expect(problem(sku).errors).toContainEqual(
        expect.objectContaining({ path: "sku", code: "invalid_format" }),
      );
    });

    it("answers 400, not 500, for a deeply nested attribute value", async () => {
      const product = await createProduct();
      const deep = `${"[".repeat(50_000)}"x"${"]".repeat(50_000)}`;
      const result = await http(
        running.baseUrl,
        "PATCH",
        variantPath(product.id, product.variants[0]?.id),
        { rawBody: `{"attributes":{"${fx.supplierAttributeCode}":${deep}}}` },
      );
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        { path: `attributes.${fx.supplierAttributeCode}`, code: "invalid_type" },
      ]);
    });

    it("answers 404 for an unknown variant, a variant of another product or an unknown product", async () => {
      const product = await sixVariants();
      const other = await createProduct();
      expect((await call("PATCH", variantPath(product.id, MISSING_ID), {})).status).toBe(404);
      expect((await call("PATCH", variantPath(product.id, other.variants[0]?.id), {})).status).toBe(
        404,
      );
      expect((await call("PATCH", variantPath(MISSING_ID, MISSING_ID), {})).status).toBe(404);
      expect((await call("PATCH", variantPath(product.id, "not-a-uuid"), {})).status).toBe(400);
    });
  });

  describe("serialization by the product row lock", () => {
    it("generate waits for a transaction that holds the product row", async () => {
      const product = await sixVariants();
      await pool.query("delete from variant where id = $1", [variantOf(product, "red", "m").id]);
      await expectWaitsForProductLock(
        pool,
        product.id,
        () => call("POST", `${variantPath(product.id)}/generate`),
        200,
      );
      expect(await variantRows(product.id)).toHaveLength(6);
    });

    it("create, update and delete wait for it too", async () => {
      const product = await sixVariants();
      const removed = variantOf(product, "red", "m");
      const target = variantOf(product, "blue", "s");
      await pool.query("delete from variant where id = $1", [removed.id]);
      await expectWaitsForProductLock(
        pool,
        product.id,
        () =>
          call("POST", variantPath(product.id), {
            optionValueIds: [fx.color.values.red, fx.size.values.m],
          }),
        201,
      );
      await expectWaitsForProductLock(
        pool,
        product.id,
        () => call("PATCH", variantPath(product.id, target.id), { barcode: "1" }),
        200,
      );
      await expectWaitsForProductLock(
        pool,
        product.id,
        () => call("DELETE", variantPath(product.id, target.id)),
        204,
      );
    });
  });

  describe("DELETE /admin/products/:id/variants/:variantId", () => {
    it("deletes a non-default variant of a draft product and keeps the invariants", async () => {
      const product = await sixVariants();
      const target = variantOf(product, "blue", "s");
      const result = await call("DELETE", variantPath(product.id, target.id));
      expect(result.status).toBe(204);
      expect((await call("GET", variantPath(product.id, target.id))).status).toBe(404);
      expect((await getProduct(product.id)).variants).toHaveLength(5);
      const orphans = await pool.query(
        "select count(*)::int as count from variant_option_value where variant_id = $1",
        [target.id],
      );
      expect(orphans.rows[0].count).toBe(0);
      await expectVariantInvariants(pool, product.id);
    });

    it("refuses the default variant, then allows it after the default moved", async () => {
      const product = await sixVariants();
      const current = product.variants.find((variant) => variant.isDefault);
      const refused = await call("DELETE", variantPath(product.id, current?.id));
      expect(refused.status).toBe(409);
      expect(problem(refused)).toMatchObject({ code: "rule_violation", rule: "default_variant" });
      const target = variantOf(product, "green", "s");
      await call("PATCH", variantPath(product.id, target.id), { isDefault: true });
      expect((await call("DELETE", variantPath(product.id, current?.id))).status).toBe(204);
      await expectVariantInvariants(pool, product.id);
    });

    it("refuses the last variant", async () => {
      const product = await createProduct();
      const result = await call("DELETE", variantPath(product.id, product.variants[0]?.id));
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({ code: "rule_violation", rule: "last_variant" });
      expect(await variantRows(product.id)).toHaveLength(1);
    });

    it("refuses variants of an active or archived product", async () => {
      const product = await sixVariants();
      const target = variantOf(product, "blue", "s");
      await setStatus(product.id, "publish");
      const active = await call("DELETE", variantPath(product.id, target.id));
      expect(active.status).toBe(409);
      expect(problem(active)).toMatchObject({ code: "rule_violation", rule: "product_not_draft" });
      await setStatus(product.id, "archive");
      const archived = await call("DELETE", variantPath(product.id, target.id));
      expect(archived.status).toBe(409);
      expect(problem(archived).rule).toBe("product_not_draft");
      expect(await variantRows(product.id)).toHaveLength(6);
    });

    it("answers 404 for an unknown variant and for a variant of another product", async () => {
      const product = await sixVariants();
      const other = await createProduct();
      expect((await call("DELETE", variantPath(product.id, MISSING_ID))).status).toBe(404);
      expect((await call("DELETE", variantPath(product.id, other.variants[0]?.id))).status).toBe(
        404,
      );
      expect((await call("DELETE", variantPath(MISSING_ID, MISSING_ID))).status).toBe(404);
      expect(await variantRows(other.id)).toHaveLength(1);
    });
  });
});

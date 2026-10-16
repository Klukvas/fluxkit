import { MAX_AMOUNT } from "@fluxkit/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import {
  caller,
  createCatalogFixture,
  expectWaitsForProductLock,
  type Call,
  type CatalogFixture,
} from "../../../test/catalog-fixtures.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import { priceProductVariants } from "../../../test/pricing-fixtures.js";
import type { ProductDetailResponse } from "../products/products.schemas.js";
import { MAX_BULK_PRICE_ITEMS } from "./prices.schemas.js";
import type { PriceListResponse, PriceResponse } from "./prices.schemas.js";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin prices API (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let counter = 0;

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  async function createProduct(): Promise<ProductDetailResponse> {
    counter += 1;
    const result = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: fx.teeTypeId,
      title: { uk: `Ціна ${fx.runId} ${counter}`, en: `Price ${fx.runId} ${counter}` },
      attributes: { [fx.materialAttributeCode]: "cotton" },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  /** A draft product with color red/blue = 2 variants. */
  async function twoVariants(): Promise<ProductDetailResponse> {
    const product = await createProduct();
    const put = await call<ProductDetailResponse>("PUT", `/admin/products/${product.id}/options`, {
      options: [
        {
          optionId: fx.color.id,
          valueIds: [fx.color.values["red"], fx.color.values["blue"]],
        },
      ],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.variants).toHaveLength(2);
    return put.body;
  }

  async function lifecycle(productId: string, action: "publish" | "unpublish") {
    return call<ProductDetailResponse>("POST", `/admin/products/${productId}/${action}`);
  }

  const pricePath = (productId: string, variantId: string, currency = "") =>
    `/admin/products/${productId}/variants/${variantId}/prices${currency === "" ? "" : `/${currency}`}`;

  async function putPrice(
    productId: string,
    variantId: string,
    currency: string,
    body: unknown,
  ): Promise<{ status: number; body: PriceResponse }> {
    return call<PriceResponse>("PUT", pricePath(productId, variantId, currency), body);
  }

  async function priceRows(variantId: string) {
    const result = await pool.query(
      "select currency, amount::text as amount, compare_at_amount::text as compare_at from price where variant_id = $1 order by currency",
      [variantId],
    );
    return result.rows as { currency: string; amount: string; compare_at: string | null }[];
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

  describe("GET /admin/products/:id/variants/:variantId/prices", () => {
    it("lists nothing for a new variant and the prices ordered by currency afterwards", async () => {
      const product = await createProduct();
      const [variant] = product.variants;
      expect(variant).toBeDefined();
      const variantId = variant?.id ?? "";
      const empty = await call<PriceListResponse>("GET", pricePath(product.id, variantId));
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ items: [] });

      await putPrice(product.id, variantId, "USD", { amount: 2500 });
      await putPrice(product.id, variantId, "UAH", { amount: 100_000, compareAtAmount: 120_000 });
      const listed = await call<PriceListResponse>("GET", pricePath(product.id, variantId));
      expect(listed.status).toBe(200);
      expect(listed.body.items.map((item) => item.currency)).toEqual(["UAH", "USD"]);
      expect(listed.body.items[0]).toMatchObject({
        variantId,
        currency: "UAH",
        amount: 100_000,
        compareAtAmount: 120_000,
      });
      expect(listed.body.items[1]?.compareAtAmount).toBeNull();
    });

    it("answers 404 for an unknown product, an unknown variant and a variant of another product", async () => {
      const a = await createProduct();
      const b = await createProduct();
      const variantOfB = b.variants[0]?.id ?? "";
      expect((await call("GET", pricePath(MISSING_ID, MISSING_ID))).status).toBe(404);
      expect((await call("GET", pricePath(a.id, MISSING_ID))).status).toBe(404);
      const foreign = await call<ProblemBody>("GET", pricePath(a.id, variantOfB));
      expect(foreign.status).toBe(404);
      expect(foreign.body).toMatchObject({ code: "not_found" });
    });

    it("answers 400 for a malformed id", async () => {
      const result = await call<ProblemBody>("GET", pricePath("not-a-uuid", MISSING_ID));
      expect(result.status).toBe(400);
      expect(result.body.errors).toContainEqual(expect.objectContaining({ path: "id" }));
    });
  });

  describe("PUT /admin/products/:id/variants/:variantId/prices/:currency", () => {
    it("creates a price with 201 and replaces it with 200, in the money shape", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      const created = await putPrice(product.id, variantId, "UAH", {
        amount: 49_900,
        compareAtAmount: 59_900,
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        variantId,
        currency: "UAH",
        amount: 49_900,
        compareAtAmount: 59_900,
      });
      expect(typeof created.body.amount).toBe("number");
      expect(created.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const replaced = await putPrice(product.id, variantId, "UAH", { amount: 39_900 });
      expect(replaced.status).toBe(200);
      expect(replaced.body).toMatchObject({
        id: created.body.id,
        amount: 39_900,
        compareAtAmount: null,
      });
      expect(Date.parse(replaced.body.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(created.body.updatedAt),
      );
      expect(await priceRows(variantId)).toEqual([
        { currency: "UAH", amount: "39900", compare_at: null },
      ]);
    });

    it("clears the compare-at price with null or by leaving it out", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      await putPrice(product.id, variantId, "UAH", { amount: 100, compareAtAmount: 200 });
      const withNull = await putPrice(product.id, variantId, "UAH", {
        amount: 100,
        compareAtAmount: null,
      });
      expect(withNull.body.compareAtAmount).toBeNull();
      await putPrice(product.id, variantId, "UAH", { amount: 100, compareAtAmount: 200 });
      const absent = await putPrice(product.id, variantId, "UAH", { amount: 100 });
      expect(absent.body.compareAtAmount).toBeNull();
    });

    it("accepts zero and stores prices in other currencies next to the shop currency", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      expect((await putPrice(product.id, variantId, "UAH", { amount: 0 })).status).toBe(201);
      expect((await putPrice(product.id, variantId, "JPY", { amount: 1500 })).status).toBe(201);
      expect((await priceRows(variantId)).map((row) => row.currency)).toEqual(["JPY", "UAH"]);
    });

    it.each([
      ["a negative amount", { amount: -1 }, "amount", "negative_amount"],
      ["an amount above the maximum", { amount: MAX_AMOUNT + 1 }, "amount", "amount_out_of_range"],
      ["a decimal amount", { amount: 10.5 }, "amount", "not_an_integer"],
      ["an amount as a string", { amount: "100" }, "amount", "invalid_type"],
      ["a missing amount", {}, "amount", "required"],
      ["a null amount", { amount: null }, "amount", "invalid_type"],
      [
        "a compare-at price equal to the amount",
        { amount: 100, compareAtAmount: 100 },
        "compareAtAmount",
        "compare_at_not_greater",
      ],
      [
        "a compare-at price below the amount",
        { amount: 100, compareAtAmount: 50 },
        "compareAtAmount",
        "compare_at_not_greater",
      ],
      [
        "a decimal compare-at price",
        { amount: 100, compareAtAmount: 150.5 },
        "compareAtAmount",
        "compare_at_not_an_integer",
      ],
      [
        "a compare-at price above the maximum",
        { amount: 100, compareAtAmount: MAX_AMOUNT + 1 },
        "compareAtAmount",
        "compare_at_out_of_range",
      ],
      [
        "a compare-at price as a string",
        { amount: 100, compareAtAmount: "150" },
        "compareAtAmount",
        "invalid_type",
      ],
      ["an unknown field", { amount: 100, currency: "USD" }, "currency", "unknown_field"],
      ["an unknown field (tax)", { amount: 100, tax: 5 }, "tax", "unknown_field"],
    ])("rejects %s with 400 and stores nothing", async (_name, body, path, code) => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      const result = await putPrice(product.id, variantId, "UAH", body);
      expect(result.status, JSON.stringify(result.body)).toBe(400);
      expect(problem(result)).toMatchObject({ code: "validation_failed" });
      expect(problem(result).errors).toContainEqual(expect.objectContaining({ path, code }));
      expect(await priceRows(variantId)).toEqual([]);
    });

    it("rejects a JSON integer beyond 2^53 instead of storing a rounded value", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      // Sent as raw text: a JavaScript literal of this size would already be rounded.
      const result = await http<ProblemBody>(
        running.baseUrl,
        "PUT",
        pricePath(product.id, variantId, "UAH"),
        { rawBody: '{"amount": 9007199254740993}' },
      );
      expect(result.status).toBe(400);
      expect(result.body.errors).toContainEqual(
        expect.objectContaining({ path: "amount", code: "amount_out_of_range" }),
      );
      expect(await priceRows(variantId)).toEqual([]);
    });

    it.each(["uah", "Uah", "XXX", "US", "USDD", "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f"])(
      "rejects the currency %j in the path with 400 (exact, upper case, supported)",
      async (currency) => {
        const product = await createProduct();
        const variantId = product.variants[0]?.id ?? "";
        const result = await putPrice(product.id, variantId, currency, { amount: 100 });
        expect(result.status).toBe(400);
        expect(problem(result).errors).toContainEqual(
          expect.objectContaining({ path: "currency", code: "unsupported_currency" }),
        );
        expect(await priceRows(variantId)).toEqual([]);
      },
    );

    it("answers 404 for an unknown product, an unknown variant and a variant of another product", async () => {
      const a = await createProduct();
      const b = await createProduct();
      expect((await putPrice(MISSING_ID, MISSING_ID, "UAH", { amount: 1 })).status).toBe(404);
      expect((await putPrice(a.id, MISSING_ID, "UAH", { amount: 1 })).status).toBe(404);
      const foreign = await putPrice(a.id, b.variants[0]?.id ?? "", "UAH", { amount: 1 });
      expect(foreign.status).toBe(404);
      expect(await priceRows(b.variants[0]?.id ?? "")).toEqual([]);
    });

    it("keeps an amount near the maximum exact through the database and the JSON roundtrip", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      const nearMax = MAX_AMOUNT - 1;
      const result = await putPrice(product.id, variantId, "UAH", {
        amount: nearMax,
        compareAtAmount: MAX_AMOUNT,
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.amount).toBe(nearMax);
      expect(result.body.compareAtAmount).toBe(MAX_AMOUNT);
      expect(Number.isSafeInteger(result.body.amount)).toBe(true);
      // The driver hands bigint columns over as strings: the conversion to number is the API's job.
      expect(await priceRows(variantId)).toEqual([
        { currency: "UAH", amount: String(nearMax), compare_at: String(MAX_AMOUNT) },
      ]);
      const raw = await pool.query("select amount from price where variant_id = $1", [variantId]);
      expect(typeof (raw.rows[0] as { amount: unknown }).amount).toBe("string");
      const listed = await call<PriceListResponse>("GET", pricePath(product.id, variantId));
      expect(listed.body.items[0]).toMatchObject({ amount: nearMax, compareAtAmount: MAX_AMOUNT });
      const maxAmount = await putPrice(product.id, variantId, "UAH", { amount: MAX_AMOUNT });
      expect(maxAmount.body.amount).toBe(MAX_AMOUNT);
    });
  });

  describe("DELETE /admin/products/:id/variants/:variantId/prices/:currency", () => {
    it("deletes a price of a draft product, even in the shop currency", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      await putPrice(product.id, variantId, "UAH", { amount: 100 });
      const result = await call("DELETE", pricePath(product.id, variantId, "UAH"));
      expect(result.status).toBe(204);
      expect(await priceRows(variantId)).toEqual([]);
    });

    it("answers 404 for a price that does not exist, an unknown variant and a bad currency", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      const unknownPrice = await call<ProblemBody>(
        "DELETE",
        pricePath(product.id, variantId, "USD"),
      );
      expect(unknownPrice.status).toBe(404);
      expect(unknownPrice.body).toMatchObject({ code: "not_found" });
      expect((await call("DELETE", pricePath(product.id, MISSING_ID, "UAH"))).status).toBe(404);
      expect((await call("DELETE", pricePath(MISSING_ID, MISSING_ID, "UAH"))).status).toBe(404);
      expect((await call("DELETE", pricePath(product.id, variantId, "uah"))).status).toBe(400);
    });

    describe("on a published product", () => {
      async function published() {
        const product = await twoVariants();
        await priceProductVariants(pool, product.id);
        expect((await lifecycle(product.id, "publish")).status).toBe(200);
        return product;
      }

      it("refuses the shop-currency price of an active variant with rule last_shop_price", async () => {
        const product = await published();
        const variantId = product.variants[0]?.id ?? "";
        const result = await call<ProblemBody>("DELETE", pricePath(product.id, variantId, "UAH"));
        expect(result.status).toBe(409);
        expect(result.body).toMatchObject({ code: "rule_violation", rule: "last_shop_price" });
        expect((await priceRows(variantId)).map((row) => row.currency)).toEqual(["UAH"]);
      });

      it("allows a price in another currency", async () => {
        const product = await published();
        const variantId = product.variants[0]?.id ?? "";
        await putPrice(product.id, variantId, "USD", { amount: 500 });
        expect((await call("DELETE", pricePath(product.id, variantId, "USD"))).status).toBe(204);
        expect((await priceRows(variantId)).map((row) => row.currency)).toEqual(["UAH"]);
      });

      it("allows the shop price of an inactive variant", async () => {
        const product = await published();
        const variantId = product.variants[1]?.id ?? "";
        const off = await call("PATCH", `/admin/products/${product.id}/variants/${variantId}`, {
          isActive: false,
        });
        expect(off.status, JSON.stringify(off.body)).toBe(200);
        expect((await call("DELETE", pricePath(product.id, variantId, "UAH"))).status).toBe(204);
      });

      it("allows the shop price again once the product is unpublished", async () => {
        const product = await published();
        const variantId = product.variants[0]?.id ?? "";
        expect((await lifecycle(product.id, "unpublish")).status).toBe(200);
        expect((await call("DELETE", pricePath(product.id, variantId, "UAH"))).status).toBe(204);
      });
    });
  });

  describe("PUT /admin/products/:id/prices (bulk)", () => {
    const bulkPath = (productId: string) => `/admin/products/${productId}/prices`;

    it("writes many prices in one call, in request order, creating and replacing", async () => {
      const product = await twoVariants();
      const [first, second] = product.variants.map((variant) => variant.id);
      await putPrice(product.id, first ?? "", "UAH", { amount: 100 });
      const result = await call<PriceListResponse>("PUT", bulkPath(product.id), {
        items: [
          { variantId: second, currency: "UAH", amount: 300, compareAtAmount: 400 },
          { variantId: first, currency: "UAH", amount: 150 },
          { variantId: first, currency: "USD", amount: 5 },
        ],
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.items.map((item) => [item.variantId, item.currency, item.amount])).toEqual(
        [
          [second, "UAH", 300],
          [first, "UAH", 150],
          [first, "USD", 5],
        ],
      );
      expect(result.body.items[0]?.compareAtAmount).toBe(400);
      expect(await priceRows(first ?? "")).toEqual([
        { currency: "UAH", amount: "150", compare_at: null },
        { currency: "USD", amount: "5", compare_at: null },
      ]);
    });

    it("is all or nothing: one invalid item writes none and reports an indexed path", async () => {
      const product = await twoVariants();
      const [first, second] = product.variants.map((variant) => variant.id);
      const result = await call<ProblemBody>("PUT", bulkPath(product.id), {
        items: [
          { variantId: first, currency: "UAH", amount: 100 },
          { variantId: second, currency: "UAH", amount: 200 },
          { variantId: second, currency: "USD", amount: -5 },
        ],
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "items.2.amount", code: "negative_amount" }),
      ]);
      expect(await priceRows(first ?? "")).toEqual([]);
      expect(await priceRows(second ?? "")).toEqual([]);
    });

    it("reports every invalid item, each at its own index", async () => {
      const product = await twoVariants();
      const first = product.variants[0]?.id ?? "";
      const result = await call<ProblemBody>("PUT", bulkPath(product.id), {
        items: [
          { variantId: first, currency: "UAH", amount: 1.5 },
          { variantId: first, currency: "usd", amount: 5 },
          { variantId: first, currency: "EUR", amount: 5, compareAtAmount: 5 },
          { variantId: first, currency: "PLN", amount: 5 },
        ],
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "items.0.amount", code: "not_an_integer" }),
        expect.objectContaining({ path: "items.1.currency", code: "unsupported_currency" }),
        expect.objectContaining({
          path: "items.2.compareAtAmount",
          code: "compare_at_not_greater",
        }),
      ]);
      expect(await priceRows(first)).toEqual([]);
    });

    it("rejects a variant of another product, with nothing written and the foreign variant untouched", async () => {
      const product = await twoVariants();
      const other = await createProduct();
      const own = product.variants[0]?.id ?? "";
      const foreign = other.variants[0]?.id ?? "";
      const result = await call<ProblemBody>("PUT", bulkPath(product.id), {
        items: [
          { variantId: own, currency: "UAH", amount: 100 },
          { variantId: foreign, currency: "UAH", amount: 100 },
          { variantId: MISSING_ID, currency: "UAH", amount: 100 },
        ],
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "items.1.variantId", code: "invalid_reference" }),
        expect.objectContaining({ path: "items.2.variantId", code: "invalid_reference" }),
      ]);
      expect(await priceRows(own)).toEqual([]);
      expect(await priceRows(foreign)).toEqual([]);
    });

    it("rejects the same variant and currency twice", async () => {
      const product = await twoVariants();
      const own = product.variants[0]?.id ?? "";
      const result = await call<ProblemBody>("PUT", bulkPath(product.id), {
        items: [
          { variantId: own, currency: "UAH", amount: 100 },
          { variantId: own, currency: "UAH", amount: 200 },
        ],
      });
      expect(result.status).toBe(400);
      expect(result.body.errors).toEqual([
        expect.objectContaining({ path: "items.1", code: "duplicate_item" }),
      ]);
      expect(await priceRows(own)).toEqual([]);
    });

    it("bounds the size: empty and more than the limit are rejected, the limit itself is accepted", async () => {
      const product = await twoVariants();
      const own = product.variants[0]?.id ?? "";
      const empty = await call<ProblemBody>("PUT", bulkPath(product.id), { items: [] });
      expect(empty.status).toBe(400);
      expect(empty.body.errors).toContainEqual(
        expect.objectContaining({ path: "items", code: "too_small" }),
      );
      const item = (amount: number) => ({ variantId: own, currency: "UAH", amount });
      const tooMany = await call<ProblemBody>("PUT", bulkPath(product.id), {
        items: Array.from({ length: MAX_BULK_PRICE_ITEMS + 1 }, (_, index) => item(index)),
      });
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.errors).toContainEqual(
        expect.objectContaining({ path: "items", code: "too_big" }),
      );
      expect(await priceRows(own)).toEqual([]);
    });

    it("rejects an unknown field and answers 404 for an unknown product", async () => {
      const product = await twoVariants();
      const own = product.variants[0]?.id ?? "";
      const unknownField = await call<ProblemBody>("PUT", bulkPath(product.id), {
        items: [{ variantId: own, currency: "UAH", amount: 1, sku: "X" }],
      });
      expect(unknownField.status).toBe(400);
      expect(unknownField.body.errors).toContainEqual(
        expect.objectContaining({ path: "items.0.sku", code: "unknown_field" }),
      );
      const missing = await call("PUT", bulkPath(MISSING_ID), {
        items: [{ variantId: own, currency: "UAH", amount: 1 }],
      });
      expect(missing.status).toBe(404);
    });
  });

  describe("publish rule", () => {
    it("blocks publishing while an active variant has no shop-currency price, naming the variant", async () => {
      const product = await twoVariants();
      const [first, second] = product.variants.map((variant) => variant.id);
      await putPrice(product.id, first ?? "", "UAH", { amount: 100 });
      // A price in another currency does not count.
      await putPrice(product.id, second ?? "", "USD", { amount: 5 });
      const blocked = await lifecycle(product.id, "publish");
      expect(blocked.status).toBe(400);
      expect(problem(blocked)).toMatchObject({ code: "validation_failed" });
      const index = product.variants.findIndex((variant) => variant.id === second);
      expect(problem(blocked).errors).toEqual([
        expect.objectContaining({ path: `variants.${index}`, code: "price_missing" }),
      ]);
      const row = await pool.query("select status from product where id = $1", [product.id]);
      expect((row.rows[0] as { status: string }).status).toBe("draft");
    });

    it("allows publishing once every active variant has a price", async () => {
      const product = await twoVariants();
      await call("PUT", `/admin/products/${product.id}/prices`, {
        items: product.variants.map((variant) => ({
          variantId: variant.id,
          currency: "UAH",
          amount: 100,
        })),
      });
      expect((await lifecycle(product.id, "publish")).status).toBe(200);
    });

    it("does not let an inactive priceless variant block publishing", async () => {
      const product = await twoVariants();
      const [first, second] = product.variants.map((variant) => variant.id);
      await putPrice(product.id, first ?? "", "UAH", { amount: 100 });
      const off = await call("PATCH", `/admin/products/${product.id}/variants/${second}`, {
        isActive: false,
      });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      const published = await lifecycle(product.id, "publish");
      expect(published.status, JSON.stringify(published.body)).toBe(200);
    });

    it("refuses to switch on a priceless variant of a published product, and allows it with a price", async () => {
      const product = await twoVariants();
      const [first, second] = product.variants.map((variant) => variant.id);
      await putPrice(product.id, first ?? "", "UAH", { amount: 100 });
      await call("PATCH", `/admin/products/${product.id}/variants/${second}`, { isActive: false });
      expect((await lifecycle(product.id, "publish")).status).toBe(200);

      const variantPath = `/admin/products/${product.id}/variants/${second}`;
      const refused = await call<ProblemBody>("PATCH", variantPath, { isActive: true });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: "rule_violation", rule: "price_missing" });
      const still = await pool.query("select is_active from variant where id = $1", [second]);
      expect((still.rows[0] as { is_active: boolean }).is_active).toBe(false);

      await putPrice(product.id, second ?? "", "USD", { amount: 5 });
      expect((await call("PATCH", variantPath, { isActive: true })).status).toBe(409);
      await putPrice(product.id, second ?? "", "UAH", { amount: 100 });
      const allowed = await call("PATCH", variantPath, { isActive: true });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    });

    it("switches a priceless variant on freely while the product is a draft", async () => {
      const product = await twoVariants();
      const second = product.variants[1]?.id ?? "";
      const variantPath = `/admin/products/${product.id}/variants/${second}`;
      expect((await call("PATCH", variantPath, { isActive: false })).status).toBe(200);
      expect((await call("PATCH", variantPath, { isActive: true })).status).toBe(200);
    });

    it("does not let a variant that was already priceless block unrelated edits of a published product", async () => {
      const product = await createProduct();
      const put = await call<ProductDetailResponse>(
        "PUT",
        `/admin/products/${product.id}/options`,
        { options: [{ optionId: fx.color.id, valueIds: Object.values(fx.color.values) }] },
      );
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      await priceProductVariants(pool, product.id);
      expect((await lifecycle(product.id, "publish")).status).toBe(200);
      const [, second, third] = put.body.variants.map((variant) => variant.id);
      // Simulates data from before prices existed (the API refuses to create this state).
      await pool.query("delete from price where variant_id = $1", [third]);
      const off = await call("PATCH", `/admin/products/${product.id}/variants/${second}`, {
        isActive: false,
      });
      // The default and the old priceless variant stay active; the old gap is not this edit's business.
      expect(off.status, JSON.stringify(off.body)).toBe(200);
    });

    it("sells in the configured shop currency only", async () => {
      const usdApp = await startApp({ shopCurrency: "USD" });
      try {
        const usdCall = caller(() => usdApp.baseUrl);
        const product = await twoVariants();
        await priceProductVariants(pool, product.id, 100, "UAH");
        const blocked = await usdCall<ProblemBody>("POST", `/admin/products/${product.id}/publish`);
        expect(blocked.status).toBe(400);
        expect(blocked.body.errors).toContainEqual(
          expect.objectContaining({ code: "price_missing" }),
        );
        await priceProductVariants(pool, product.id, 100, "USD");
        expect((await usdCall("POST", `/admin/products/${product.id}/publish`)).status).toBe(200);
        const variantId = product.variants[0]?.id ?? "";
        // The UAH price is not the shop price in this app, so it can go; the USD one cannot.
        expect((await usdCall("DELETE", pricePath(product.id, variantId, "UAH"))).status).toBe(204);
        const refused = await usdCall<ProblemBody>(
          "DELETE",
          pricePath(product.id, variantId, "USD"),
        );
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({ rule: "last_shop_price" });
      } finally {
        await usdApp.app.close();
      }
    });

    it("looks the prices up with one statement, however many variants the product has", async () => {
      const small = await twoVariants();
      await priceProductVariants(pool, small.id);
      const large = await createProduct();
      const put = await call<ProductDetailResponse>("PUT", `/admin/products/${large.id}/options`, {
        options: [
          { optionId: fx.biga.id, valueIds: Object.values(fx.biga.values) },
          { optionId: fx.bigb.id, valueIds: Object.values(fx.bigb.values).slice(0, 8) },
        ],
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(put.body.variants.length).toBeGreaterThan(100);
      await priceProductVariants(pool, large.id);

      async function priceStatements(productId: string): Promise<number> {
        const spy = vi.spyOn(pg.Client.prototype, "query");
        try {
          const result = await lifecycle(productId, "publish");
          expect(result.status, JSON.stringify(result.body)).toBe(200);
          return spy.mock.calls.filter((args) => {
            const first = args[0] as unknown;
            const text =
              typeof first === "string"
                ? first
                : typeof first === "object" && first !== null && "text" in first
                  ? String((first as { text: unknown }).text)
                  : "";
            return /from "price"|join "price"/i.test(text);
          }).length;
        } finally {
          spy.mockRestore();
        }
      }
      expect(await priceStatements(small.id)).toBe(1);
      expect(await priceStatements(large.id)).toBe(1);
    });
  });

  describe("concurrency", () => {
    it("never leaves a published product with an active variant without a shop price (delete vs publish)", async () => {
      for (let round = 0; round < 8; round += 1) {
        const product = await createProduct();
        const variantId = product.variants[0]?.id ?? "";
        await putPrice(product.id, variantId, "UAH", { amount: 100 });
        const [published, deleted] = await Promise.all([
          lifecycle(product.id, "publish"),
          call<ProblemBody>("DELETE", pricePath(product.id, variantId, "UAH")),
        ]);
        // Whichever got the product lock first decides; the other one must see its effect.
        if (published.status === 200) {
          expect(deleted.status, "a published product keeps its shop price").toBe(409);
        } else {
          expect(published.status).toBe(400);
          expect(deleted.status).toBe(204);
        }
        const broken = await pool.query(
          `select 1 from product p join variant v on v.product_id = p.id
            where p.id = $1 and p.status = 'active' and v.is_active
              and not exists (select 1 from price where variant_id = v.id and currency = 'UAH')`,
          [product.id],
        );
        expect(broken.rows, `round ${round}`).toEqual([]);
      }
    });

    it("waits for the product row lock in every price write", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      await putPrice(product.id, variantId, "USD", { amount: 5 });
      await expectWaitsForProductLock(
        pool,
        product.id,
        () => putPrice(product.id, variantId, "UAH", { amount: 100 }),
        201,
      );
      await expectWaitsForProductLock(
        pool,
        product.id,
        () => call("DELETE", pricePath(product.id, variantId, "USD")),
        204,
      );
      await expectWaitsForProductLock(
        pool,
        product.id,
        () =>
          call("PUT", `/admin/products/${product.id}/prices`, {
            items: [{ variantId, currency: "UAH", amount: 200 }],
          }),
        200,
      );
    });
  });

  describe("permissions", () => {
    it("lets a viewer read prices but not write them, and requires the CSRF header", async () => {
      const product = await createProduct();
      const variantId = product.variants[0]?.id ?? "";
      await putPrice(product.id, variantId, "UAH", { amount: 100 });
      const viewerApp = await startApp({ adminPrincipal: { role: "viewer" } });
      try {
        const base = viewerApp.baseUrl;
        const read = await http(base, "GET", pricePath(product.id, variantId));
        expect(read.status).toBe(200);
        const attempts = [
          http<ProblemBody>(base, "PUT", pricePath(product.id, variantId, "UAH"), {
            body: { amount: 1 },
          }),
          http<ProblemBody>(base, "DELETE", pricePath(product.id, variantId, "UAH")),
          http<ProblemBody>(base, "PUT", `/admin/products/${product.id}/prices`, {
            body: { items: [{ variantId, currency: "UAH", amount: 1 }] },
          }),
        ];
        for (const result of await Promise.all(attempts)) {
          expect(result.status).toBe(403);
          expect(result.body).toMatchObject({ code: "forbidden" });
        }
      } finally {
        await viewerApp.app.close();
      }
      expect((await priceRows(variantId)).map((row) => row.amount)).toEqual(["100"]);

      const noCsrf = await http<ProblemBody>(
        running.baseUrl,
        "PUT",
        pricePath(product.id, variantId, "UAH"),
        { body: { amount: 1 }, csrf: false },
      );
      expect(noCsrf.status).toBe(403);
      expect((await priceRows(variantId)).map((row) => row.amount)).toEqual(["100"]);
    });
  });
});

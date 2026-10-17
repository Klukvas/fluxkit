import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { ensureMigrated } from "../../../test/migrate.js";
import { insertSoldLine, deleteOrders } from "../../../test/order-fixtures.js";
import { priceProductVariants } from "../../../test/pricing-fixtures.js";
import { ProductsRepository } from "../products/products.repository.js";
import type { ProductDetailResponse } from "../products/products.schemas.js";

const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin product options API (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let call: Call;
  let fx: CatalogFixture;
  let counter = 0;

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

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
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

  async function putOptions(productId: string, ...selections: ReturnType<typeof sel>[]) {
    return call<ProductDetailResponse>("PUT", `/admin/products/${productId}/options`, {
      options: selections,
    });
  }

  async function okPut(productId: string, ...selections: ReturnType<typeof sel>[]) {
    const result = await putOptions(productId, ...selections);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return result.body;
  }

  async function getProduct(id: string): Promise<ProductDetailResponse> {
    const result = await call<ProductDetailResponse>("GET", `/admin/products/${id}`);
    expect(result.status).toBe(200);
    return result.body;
  }

  /** Publishing needs a shop-currency price on every active variant. */
  async function publish(productId: string) {
    await priceProductVariants(pool, productId);
    return call("POST", `/admin/products/${productId}/publish`);
  }

  async function productIn(
    status: "draft" | "active" | "archived",
  ): Promise<ProductDetailResponse> {
    const product = await createProduct(fx.teeTypeId, { [fx.materialAttributeCode]: "cotton" });
    await okPut(product.id, sel(fx.color, ["red", "blue"]), sel(fx.size, ["s", "m"]));
    if (status !== "draft") {
      expect((await publish(product.id)).status).toBe(200);
    }
    if (status === "archived") {
      expect((await call("POST", `/admin/products/${product.id}/archive`)).status).toBe(200);
    }
    return getProduct(product.id);
  }

  async function dbState(productId: string) {
    const variants = await pool.query(
      "select id, sku from variant where product_id = $1 order by sku",
      [productId],
    );
    const options = await pool.query(
      "select option_id from product_option where product_id = $1 order by option_id",
      [productId],
    );
    const values = await pool.query(
      "select option_value_id from product_option_value where product_id = $1 order by option_value_id",
      [productId],
    );
    return { variants: variants.rows, options: options.rows, values: values.rows };
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

  describe("PUT /admin/products/:id/options", () => {
    it("generates the 2 x 3 = 6 variants with signatures, SKUs and exactly one default", async () => {
      const product = await createProduct();
      const updated = await okPut(
        product.id,
        sel(fx.color, ["red", "blue", "green"]),
        sel(fx.size, ["s", "m"]),
      );

      expect(updated.variants).toHaveLength(6);
      expect(updated.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
      expect(updated.variants.map((variant) => variant.optionSignature).sort()).toEqual(
        ["red", "blue", "green"]
          .flatMap((color) =>
            ["s", "m"].map((size) => `${fx.color.code}=${color};${fx.size.code}=${size}`),
          )
          .sort(),
      );
      const redSmall = updated.variants.find(
        (variant) => variant.optionSignature === `${fx.color.code}=red;${fx.size.code}=s`,
      );
      expect(redSmall).toMatchObject({
        sku: `${product.slug}-red-s`.toUpperCase(),
        isDefault: true,
        isActive: true,
        attributes: {},
        position: 0,
      });
      expect(redSmall?.optionValues).toEqual([
        {
          optionId: fx.color.id,
          optionCode: fx.color.code,
          optionValueId: fx.color.values.red,
          valueCode: "red",
        },
        {
          optionId: fx.size.id,
          optionCode: fx.size.code,
          optionValueId: fx.size.values.s,
          valueCode: "s",
        },
      ]);
      expect(updated.options.map((option) => option.optionCode)).toEqual([
        fx.color.code,
        fx.size.code,
      ]);
      expect(updated.options[0]?.values.map((value) => [value.valueCode, value.position])).toEqual([
        ["red", 0],
        ["blue", 1],
        ["green", 2],
      ]);
      const rows = await pool.query(
        "select count(*)::int as count from variant_option_value where product_id = $1",
        [product.id],
      );
      expect(rows.rows[0].count).toBe(12);
      await expectVariantInvariants(pool, product.id);
    });

    it("is reflected by GET /admin/products/:id (options and variants)", async () => {
      const product = await createProduct();
      const updated = await okPut(product.id, sel(fx.color, ["red", "blue"]));
      const read = await getProduct(product.id);
      expect(read.options).toEqual(updated.options);
      expect(read.variants).toEqual(updated.variants);
      expect(read.options).toHaveLength(1);
      expect(read.variants).toHaveLength(2);
    });

    it("is idempotent: the same selection changes nothing", async () => {
      const product = await createProduct();
      const first = await okPut(product.id, sel(fx.color, ["red", "blue"]), sel(fx.size, ["s"]));
      const second = await okPut(product.id, sel(fx.color, ["red", "blue"]), sel(fx.size, ["s"]));
      expect(second.variants.map((variant) => variant.id)).toEqual(
        first.variants.map((variant) => variant.id),
      );
      await expectVariantInvariants(pool, product.id);
    });

    it("keeps the existing variants (ids and edited SKUs) when only values are added", async () => {
      const product = await createProduct();
      const first = await okPut(product.id, sel(fx.color, ["red"]), sel(fx.size, ["s"]));
      const original = first.variants[0];
      expect(original).toBeDefined();
      const edited = await call("PATCH", `/admin/products/${product.id}/variants/${original?.id}`, {
        sku: `EDITED-${fx.runId}`.toUpperCase(),
      });
      expect(edited.status).toBe(200);

      const second = await okPut(
        product.id,
        sel(fx.color, ["red", "blue"]),
        sel(fx.size, ["s", "m"]),
      );
      expect(second.variants).toHaveLength(4);
      const kept = second.variants.find((variant) => variant.id === original?.id);
      expect(kept).toMatchObject({ sku: `EDITED-${fx.runId}`.toUpperCase(), isDefault: true });
      expect(second.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
      await expectVariantInvariants(pool, product.id);
    });

    it("rebuilds the variants when a value is removed, with exactly one default", async () => {
      const product = await createProduct();
      await okPut(product.id, sel(fx.color, ["red", "blue", "green"]), sel(fx.size, ["s", "m"]));
      const updated = await okPut(
        product.id,
        sel(fx.color, ["blue", "green"]),
        sel(fx.size, ["s", "m"]),
      );
      expect(updated.variants).toHaveLength(4);
      expect(updated.variants.some((variant) => variant.optionSignature.includes("red"))).toBe(
        false,
      );
      expect(updated.options[0]?.values.map((value) => value.valueCode)).toEqual(["blue", "green"]);
      await expectVariantInvariants(pool, product.id);
    });

    it("rebuilds with a new option: the old default variant is replaced by the combinations", async () => {
      const product = await createProduct();
      const oldDefault = product.variants[0];
      const updated = await okPut(product.id, sel(fx.color, ["red", "blue"]));
      expect(updated.variants).toHaveLength(2);
      expect(updated.variants.map((variant) => variant.id)).not.toContain(oldDefault?.id);
      expect(updated.variants.filter((variant) => variant.isDefault)).toHaveLength(1);
      await expectVariantInvariants(pool, product.id);
    });

    it("gives a product without options its single default variant back", async () => {
      const product = await createProduct();
      await okPut(product.id, sel(fx.color, ["red", "blue"]), sel(fx.size, ["s"]));
      const updated = await okPut(product.id);
      expect(updated.options).toEqual([]);
      expect(updated.variants).toHaveLength(1);
      expect(updated.variants[0]).toMatchObject({
        optionSignature: "",
        isDefault: true,
        sku: product.slug.toUpperCase(),
        optionValues: [],
      });
      await expectVariantInvariants(pool, product.id);
    });

    it("keeps the single default variant of a simple product when called with no options", async () => {
      const product = await createProduct();
      const updated = await okPut(product.id);
      expect(updated.variants.map((variant) => variant.id)).toEqual(
        product.variants.map((variant) => variant.id),
      );
    });

    it("reorders options and values without touching the variants", async () => {
      const product = await createProduct();
      const first = await okPut(product.id, sel(fx.color, ["red", "blue"]), sel(fx.size, ["s"]));
      const second = await okPut(product.id, sel(fx.size, ["s"]), sel(fx.color, ["blue", "red"]));
      expect(second.options.map((option) => option.optionCode)).toEqual([
        fx.size.code,
        fx.color.code,
      ]);
      expect(second.options[1]?.values.map((value) => value.valueCode)).toEqual(["blue", "red"]);
      expect(second.variants.map((variant) => variant.id).sort()).toEqual(
        first.variants.map((variant) => variant.id).sort(),
      );
    });

    it("accepts exactly 250 variants (25 x 10)", async () => {
      const product = await createProduct();
      const codesA = Array.from({ length: 25 }, (_, index) => `a${index + 1}`);
      const codesB = Array.from({ length: 10 }, (_, index) => `b${index + 1}`);
      const updated = await okPut(product.id, sel(fx.biga, codesA), sel(fx.bigb, codesB));
      expect(updated.variants).toHaveLength(250);
      await expectVariantInvariants(pool, product.id);
    });

    it("refuses more than 250 new variants and rolls everything back", async () => {
      const product = await createProduct();
      const before = await dbState(product.id);
      const result = await putOptions(
        product.id,
        sel(fx.biga, Object.keys(fx.biga.values)),
        sel(fx.bigb, Object.keys(fx.bigb.values)),
      );
      expect(result.status).toBe(400);
      expect(problem(result)).toMatchObject({
        code: "validation_failed",
        errors: [{ path: "variants", code: "too_many_new_variants" }],
      });
      expect(await dbState(product.id)).toEqual(before);
    });

    it("rejects an empty value list", async () => {
      const product = await createProduct();
      const result = await putOptions(product.id, { optionId: fx.color.id, valueIds: [] });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([{ path: "options.0", code: "empty_value_list" }]);
    });

    it("rejects a duplicate option and a duplicate value, naming the position", async () => {
      const product = await createProduct();
      const duplicateOption = await putOptions(
        product.id,
        sel(fx.color, ["red"]),
        sel(fx.color, ["blue"]),
      );
      expect(duplicateOption.status).toBe(400);
      expect(problem(duplicateOption).errors).toEqual([
        { path: "options.1", code: "duplicate_option" },
      ]);

      const red = fx.color.values.red ?? "";
      const duplicateValue = await putOptions(product.id, {
        optionId: fx.color.id,
        valueIds: [red, red],
      });
      expect(duplicateValue.status).toBe(400);
      expect(problem(duplicateValue).errors).toEqual([
        { path: "options.0.valueIds.1", code: "duplicate_value" },
      ]);
    });

    it("rejects more than 3 options and more than 30 values per option", async () => {
      const product = await createProduct();
      const four = await putOptions(
        product.id,
        sel(fx.color, ["red"]),
        sel(fx.size, ["s"]),
        sel(fx.finish, ["matte"]),
        sel(fx.extra, ["x1"]),
      );
      expect(four.status).toBe(400);
      expect(problem(four).errors).toContainEqual(
        expect.objectContaining({ path: "options", code: "too_many_options" }),
      );

      const a1 = fx.biga.values.a1 ?? "";
      const many = await putOptions(product.id, {
        optionId: fx.biga.id,
        valueIds: [...Object.values(fx.biga.values), a1, a1, a1, a1, a1],
      });
      expect(many.status).toBe(400);
      expect(problem(many).errors).toContainEqual(
        expect.objectContaining({ path: "options.0", code: "too_many_values" }),
      );
    });

    it("rejects an option the product type does not allow, and an unknown option", async () => {
      const product = await createProduct();
      const notAllowed = await putOptions(product.id, sel(fx.foreign, ["f1"]));
      expect(notAllowed.status).toBe(400);
      expect(problem(notAllowed).errors).toEqual([
        { path: "options.0", code: "option_not_allowed" },
      ]);

      const unknown = await putOptions(product.id, {
        optionId: MISSING_ID,
        valueIds: [MISSING_ID],
      });
      expect(unknown.status).toBe(400);
      expect(problem(unknown).errors).toEqual([{ path: "options.0", code: "option_not_allowed" }]);
    });

    it("rejects unknown values and values of another option", async () => {
      const product = await createProduct();
      const unknown = await putOptions(product.id, {
        optionId: fx.color.id,
        valueIds: [MISSING_ID],
      });
      expect(unknown.status).toBe(400);
      expect(problem(unknown).errors).toEqual([
        expect.objectContaining({ path: "options.0.valueIds.0", code: "invalid_reference" }),
      ]);

      const foreignValue = await putOptions(product.id, {
        optionId: fx.color.id,
        valueIds: [fx.size.values.s ?? ""],
      });
      expect(foreignValue.status).toBe(400);
      expect(problem(foreignValue).errors).toEqual([
        expect.objectContaining({ path: "options.0.valueIds.0", code: "invalid_reference" }),
      ]);
      expect((await getProduct(product.id)).options).toEqual([]);
    });

    it("validates the body shape", async () => {
      const product = await createProduct();
      const path = `/admin/products/${product.id}/options`;
      const cases: [unknown, string][] = [
        [{}, "options"],
        [{ options: "x" }, "options"],
        [[], ""],
        [{ options: [], extra: 1 }, "extra"],
        [{ options: [{ optionId: "nope", valueIds: [] }] }, "options.0.optionId"],
        [{ options: [{ optionId: fx.color.id }] }, "options.0.valueIds"],
        [{ options: [{ optionId: fx.color.id, valueIds: ["nope"] }] }, "options.0.valueIds.0"],
        [{ options: [{ optionId: fx.color.id, valueIds: [], more: 1 }] }, "options.0.more"],
      ];
      for (const [body, errorPath] of cases) {
        const result = await call("PUT", path, body);
        expect(result.status, JSON.stringify(body)).toBe(400);
        expect(problem(result).code).toBe("validation_failed");
        expect(problem(result).errors?.map((error) => error.path)).toContain(errorPath);
      }
    });

    it("answers 404 for an unknown product and 400 for a malformed id", async () => {
      const missing = await putOptions(MISSING_ID, sel(fx.color, ["red"]));
      expect(missing.status).toBe(404);
      expect(problem(missing).code).toBe("not_found");
      const malformed = await call("PUT", "/admin/products/not-a-uuid/options", { options: [] });
      expect(malformed.status).toBe(400);
    });

    it("refuses a published product (frozen options), even for the same selection", async () => {
      const active = await productIn("active");
      const before = await dbState(active.id);
      const attempts = [
        [sel(fx.color, ["red", "blue"]), sel(fx.size, ["s", "m"])],
        [sel(fx.color, ["red", "blue", "green"]), sel(fx.size, ["s", "m"])],
        [sel(fx.color, ["red"]), sel(fx.size, ["s", "m"])],
        [sel(fx.color, ["red", "blue"])],
        [sel(fx.color, ["red", "blue"]), sel(fx.size, ["s", "m"]), sel(fx.finish, ["matte"])],
        [],
      ];
      for (const selections of attempts) {
        const result = await putOptions(active.id, ...selections);
        expect(result.status, JSON.stringify(selections)).toBe(409);
        expect(problem(result)).toMatchObject({ code: "rule_violation", rule: "options_frozen" });
      }
      expect(await dbState(active.id)).toEqual(before);
      expect((await getProduct(active.id)).status).toBe("active");
    });

    it("refuses an archived product too", async () => {
      const archived = await productIn("archived");
      const result = await putOptions(archived.id, sel(fx.color, ["red"]));
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({ code: "rule_violation", rule: "options_frozen" });
    });

    it("works again after the product is unpublished back to draft", async () => {
      const active = await productIn("active");
      expect((await call("POST", `/admin/products/${active.id}/unpublish`)).status).toBe(200);
      const updated = await okPut(active.id, sel(fx.color, ["red"]));
      expect(updated.variants).toHaveLength(1);
    });

    it("answers 409 in_use and changes nothing when media still refers to a removed value", async () => {
      const product = await createProduct();
      await okPut(product.id, sel(fx.color, ["red", "blue"]));
      const media = await call("PUT", `/admin/products/${product.id}/media`, {
        media: [
          {
            url: "https://example.com/red.jpg",
            optionId: fx.color.id,
            optionValueId: fx.color.values.red,
          },
        ],
      });
      expect(media.status).toBe(200);
      const before = await dbState(product.id);
      const result = await putOptions(product.id, sel(fx.color, ["blue"]));
      expect(result.status).toBe(409);
      expect(problem(result).code).toBe("in_use");
      expect(await dbState(product.id)).toEqual(before);
    });
  });

  describe("option changes keep stock history (ADR 0014)", () => {
    async function defaultLocationId(): Promise<string> {
      const location = await pool.query("select id from location where is_default");
      return (location.rows[0] as { id: string }).id;
    }

    async function receipt(variantId: string, quantity: number): Promise<void> {
      const locationId = await defaultLocationId();
      await pool.query(
        "insert into inventory_level (variant_id, location_id, on_hand) values ($1, $2, $3)",
        [variantId, locationId, quantity],
      );
      await pool.query(
        `insert into stock_movement (variant_id, location_id, delta, kind, on_hand_after)
         values ($1, $2, $3, 'receipt', $3)`,
        [variantId, locationId, quantity],
      );
    }

    async function historyRows(productId: string): Promise<{ movements: number; levels: number }> {
      const result = await pool.query(
        `select (select count(*) from stock_movement m join variant v on v.id = m.variant_id where v.product_id = $1)::int as movements,
                (select count(*) from inventory_level l join variant v on v.id = l.variant_id where v.product_id = $1)::int as levels`,
        [productId],
      );
      return result.rows[0] as { movements: number; levels: number };
    }

    /** Sold, then unpublished: a draft again, with a receipt on one variant. */
    async function soldThenUnpublished(): Promise<ProductDetailResponse> {
      const product = await productIn("draft");
      const target = product.variants[0];
      if (target === undefined) {
        throw new Error("The product has no variant.");
      }
      await receipt(target.id, 5);
      expect((await publish(product.id)).status).toBe(200);
      expect((await call("POST", `/admin/products/${product.id}/unpublish`)).status).toBe(200);
      return getProduct(product.id);
    }

    const rebuilding: [string, (productId: string) => ReturnType<typeof putOptions>][] = [
      [
        "removing a value",
        (id) => putOptions(id, sel(fx.color, ["red"]), sel(fx.size, ["s", "m"])),
      ],
      ["removing an option", (id) => putOptions(id, sel(fx.color, ["red", "blue"]))],
      [
        "adding an option",
        (id) =>
          putOptions(
            id,
            sel(fx.color, ["red", "blue"]),
            sel(fx.size, ["s", "m"]),
            sel(fx.biga, ["a1"]),
          ),
      ],
    ];

    it.each(rebuilding)(
      "refuses %s with has_stock_history and changes nothing",
      async (_name, change) => {
        const product = await soldThenUnpublished();
        const before = await dbState(product.id);
        const historyBefore = await historyRows(product.id);
        expect(historyBefore.movements).toBe(1);

        const result = await change(product.id);
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(problem(result)).toMatchObject({
          code: "rule_violation",
          rule: "has_stock_history",
        });
        expect(await dbState(product.id)).toEqual(before);
        expect(await historyRows(product.id)).toEqual(historyBefore);
      },
    );

    it.each(rebuilding)(
      "refuses %s with has_order_lines when a sold variant has no stock rows (ADR 0020)",
      async (_name, change) => {
        const product = await productIn("draft");
        const target = product.variants[0];
        if (target === undefined) {
          throw new Error("The product has no variant.");
        }
        const { orderId, itemId } = await insertSoldLine(pool, {
          productId: product.id,
          variantId: target.id,
        });
        try {
          const before = await dbState(product.id);
          const result = await change(product.id);
          expect(result.status, JSON.stringify(result.body)).toBe(409);
          expect(problem(result)).toMatchObject({
            code: "rule_violation",
            rule: "has_order_lines",
          });
          expect(await dbState(product.id)).toEqual(before);
          const line = await pool.query("select variant_id from order_item where id = $1", [
            itemId,
          ]);
          expect(line.rows).toEqual([{ variant_id: target.id }]);
        } finally {
          await deleteOrders(pool, [orderId]);
        }
      },
    );

    it.each(rebuilding)("allows %s on a product that only has prices", async (_name, change) => {
      const product = await productIn("draft");
      await priceProductVariants(pool, product.id);
      const result = await change(product.id);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
    });

    it("still adds a value to an existing option and reorders, keeping the history", async () => {
      const product = await soldThenUnpublished();
      const historyBefore = await historyRows(product.id);
      const added = await putOptions(
        product.id,
        sel(fx.color, ["red", "blue", "green"]),
        sel(fx.size, ["s", "m"]),
      );
      expect(added.status, JSON.stringify(added.body)).toBe(200);
      expect(added.body.variants).toHaveLength(6);
      expect(await historyRows(product.id)).toEqual(historyBefore);

      const reordered = await putOptions(
        product.id,
        sel(fx.size, ["m", "s"]),
        sel(fx.color, ["green", "blue", "red"]),
      );
      expect(reordered.status, JSON.stringify(reordered.body)).toBe(200);
      expect(await historyRows(product.id)).toEqual(historyBefore);
    });

    it("waits for a reservation in progress (variant row lock) before it looks at the history", async () => {
      const product = await productIn("draft");
      const target = product.variants[0];
      if (target === undefined) {
        throw new Error("The product has no variant.");
      }
      const locationId = await defaultLocationId();
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from variant where id = $1 for share", [target.id]);
        let settled = false;
        const pending = putOptions(
          product.id,
          sel(fx.color, ["red"]),
          sel(fx.size, ["s", "m"]),
        ).then((result) => {
          settled = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled, "the option change must wait for the variant row lock").toBe(false);
        await client.query(
          `insert into reservation (variant_id, location_id, quantity, status, expires_at)
           values ($1, $2, 1, 'active', now() + interval '1 hour')`,
          [target.id, locationId],
        );
        await client.query("commit");
        const result = await pending;
        expect(result.status, JSON.stringify(result.body)).toBe(409);
        expect(problem(result)).toMatchObject({ rule: "has_stock_history" });
      } finally {
        await client.query("rollback");
        client.release();
      }
    });
  });

  describe("serialization by the product row lock", () => {
    it("PUT options and POST values wait for a transaction that holds the product row", async () => {
      const product = await createProduct();
      await expectWaitsForProductLock(
        pool,
        product.id,
        () => putOptions(product.id, sel(fx.color, ["red"])),
        200,
      );
      await expectWaitsForProductLock(
        pool,
        product.id,
        () =>
          call("POST", `/admin/products/${product.id}/options/${fx.color.id}/values`, {
            valueId: fx.color.values.blue,
          }),
        201,
      );
    });
  });

  describe("POST /admin/products/:id/options/:optionId/values", () => {
    const addValue = (productId: string, option: OptionFixture, valueId: unknown) =>
      call<ProductDetailResponse>(
        "POST",
        `/admin/products/${productId}/options/${option.id}/values`,
        { valueId },
      );

    it("adds a value to an active product and generates only the new combinations", async () => {
      const active = await productIn("active");
      const oldIds = active.variants.map((variant) => variant.id);
      const result = await addValue(active.id, fx.color, fx.color.values.green);
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.headers.get("location")).toBe(`/admin/products/${active.id}`);

      const product = result.body;
      expect(product.status).toBe("active");
      expect(product.variants).toHaveLength(6);
      const created = product.variants.filter((variant) => !oldIds.includes(variant.id));
      expect(created.map((variant) => variant.optionSignature).sort()).toEqual([
        `${fx.color.code}=green;${fx.size.code}=m`,
        `${fx.color.code}=green;${fx.size.code}=s`,
      ]);
      expect(created.every((variant) => !variant.isDefault && variant.isActive)).toBe(true);
      expect(product.options[0]?.values.map((value) => value.valueCode)).toEqual([
        "red",
        "blue",
        "green",
      ]);
      expect(product.variants.filter((variant) => oldIds.includes(variant.id))).toHaveLength(4);
      await expectVariantInvariants(pool, active.id);
      expect((await getProduct(active.id)).variants).toEqual(product.variants);
    });

    describe("a type with a required variant attribute (ADR 0008)", () => {
      const variantPath = (productId: string, variantId: string | undefined) =>
        `/admin/products/${productId}/variants/${variantId}`;

      /** A strict product with one variant that has its required attribute, moved to `status`. */
      async function strictProductIn(
        status: "draft" | "active" | "archived",
      ): Promise<ProductDetailResponse> {
        const product = await createProduct(fx.strictTypeId);
        const withOptions = await okPut(product.id, sel(fx.color, ["red"]));
        const filled = await call("PATCH", variantPath(product.id, withOptions.variants[0]?.id), {
          attributes: { [fx.batchAttributeCode]: "B-1" },
        });
        expect(filled.status, JSON.stringify(filled.body)).toBe(200);
        if (status !== "draft") {
          expect((await publish(product.id)).status).toBe(200);
        }
        if (status === "archived") {
          expect((await call("POST", `/admin/products/${product.id}/archive`)).status).toBe(200);
        }
        return getProduct(product.id);
      }

      it("creates the variant of a new value inactive on an active product, and it can be published and activated later", async () => {
        const active = await strictProductIn("active");
        const result = await addValue(active.id, fx.color, fx.color.values.blue);
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        const created = result.body.variants.find(
          (variant) => variant.id !== active.variants[0]?.id,
        );
        expect(created).toMatchObject({ isActive: false, isDefault: false, attributes: {} });
        expect(result.body.variants.filter((variant) => variant.isActive)).toHaveLength(1);

        // The store does not list the inactive variant.
        const store = await call<{ variants: { sku: string }[] }>(
          "GET",
          `/store/products/${active.slug}`,
        );
        expect(store.status).toBe(200);
        expect(store.body.variants.map((variant) => variant.sku)).toEqual([
          active.variants[0]?.sku,
        ]);

        // Unpublish and publish again: an inactive variant does not need its required attributes.
        expect((await call("POST", `/admin/products/${active.id}/unpublish`)).status).toBe(200);
        const republished = await publish(active.id);
        expect(republished.status, JSON.stringify(republished.body)).toBe(200);

        // Activating without the required attribute is refused, with it succeeds.
        const refused = await call("PATCH", variantPath(active.id, created?.id), {
          isActive: true,
        });
        expect(refused.status).toBe(400);
        expect(problem(refused).errors).toEqual([
          { path: `attributes.${fx.batchAttributeCode}`, code: "required" },
        ]);
        const filled = await call<{ isActive: boolean }>(
          "PATCH",
          variantPath(active.id, created?.id),
          { isActive: true, attributes: { [fx.batchAttributeCode]: "B-2" } },
        );
        expect(filled.status, JSON.stringify(filled.body)).toBe(200);
        expect(filled.body.isActive).toBe(true);
        const storeAfter = await call<{ variants: unknown[] }>(
          "GET",
          `/store/products/${active.slug}`,
        );
        expect(storeAfter.body.variants).toHaveLength(2);
      });

      it("creates the variant inactive on an archived product too", async () => {
        const archived = await strictProductIn("archived");
        const result = await addValue(archived.id, fx.color, fx.color.values.blue);
        expect(result.status).toBe(201);
        expect(result.body.variants.map((variant) => variant.isActive).sort()).toEqual([
          false,
          true,
        ]);
        expect((await call("POST", `/admin/products/${archived.id}/restore`)).status).toBe(200);
        expect((await publish(archived.id)).status).toBe(200);
      });

      it("keeps creating active variants on a draft", async () => {
        const draft = await strictProductIn("draft");
        const result = await addValue(draft.id, fx.color, fx.color.values.blue);
        expect(result.status).toBe(201);
        expect(result.body.variants.every((variant) => variant.isActive)).toBe(true);
      });
    });

    describe("a proposed SKU that loses a race", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      /** Takes the SKU that the next generated variant would get, as a concurrent request could. */
      async function takeSkuOfNextVariant(product: ProductDetailResponse, valueCode: string) {
        const sku = `${product.slug}-${valueCode}`.toUpperCase();
        const other = await createProduct();
        await pool.query("update variant set sku = $1 where product_id = $2", [sku, other.id]);
        return sku;
      }

      it("is proposed again and the request succeeds", async () => {
        const active = await productIn("active");
        const sku = await takeSkuOfNextVariant(active, "green-s");
        const repository = running.app.get(ProductsRepository);
        // The first lookup does not see the taken SKUs (the race); later lookups are real.
        const lookup = vi
          .spyOn(repository, "findSkusStartingWith")
          .mockResolvedValueOnce(new Set());
        const result = await addValue(active.id, fx.color, fx.color.values.green);
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(2);
        const skus = result.body.variants.map((variant) => variant.sku);
        expect(new Set(skus).size).toBe(skus.length);
        expect(skus).not.toContain(sku);
      });

      it("stops with 409 when every attempt would propose the same colliding SKU", async () => {
        const active = await productIn("active");
        await takeSkuOfNextVariant(active, "green-s");
        const lookup = vi
          .spyOn(running.app.get(ProductsRepository), "findSkusStartingWith")
          .mockResolvedValue(new Set());
        const result = await addValue(active.id, fx.color, fx.color.values.green);
        expect(result.status).toBe(409);
        expect(problem(result)).toMatchObject({ field: "sku", constraint: "variant_sku_key" });
        expect(lookup).toHaveBeenCalledTimes(2);
      });
    });

    it("works on an archived product", async () => {
      const archived = await productIn("archived");
      const result = await addValue(archived.id, fx.size, fx.size.values.l);
      expect(result.status).toBe(201);
      expect(result.body.status).toBe("archived");
      expect(result.body.variants).toHaveLength(6);
      await expectVariantInvariants(pool, archived.id);
    });

    it("on a draft behaves like extending the option list and keeps the existing variants", async () => {
      const draft = await productIn("draft");
      const oldIds = draft.variants.map((variant) => variant.id);
      const result = await addValue(draft.id, fx.color, fx.color.values.green);
      expect(result.status).toBe(201);
      expect(result.body.variants).toHaveLength(6);
      expect(oldIds.every((id) => result.body.variants.some((variant) => variant.id === id))).toBe(
        true,
      );
      await expectVariantInvariants(pool, draft.id);
    });

    it("on a draft may add an option the product does not use yet, rebuilding the variants", async () => {
      const draft = await productIn("draft");
      const result = await addValue(draft.id, fx.finish, fx.finish.values.matte);
      expect(result.status).toBe(201);
      expect(result.body.options.map((option) => option.optionCode)).toContain(fx.finish.code);
      expect(result.body.variants).toHaveLength(4);
      expect(
        result.body.variants.every((variant) => variant.optionSignature.includes("finish")),
      ).toBe(true);
      await expectVariantInvariants(pool, draft.id);
    });

    it("refuses an option the published product does not use (frozen)", async () => {
      const active = await productIn("active");
      const before = await dbState(active.id);
      const result = await addValue(active.id, fx.finish, fx.finish.values.matte);
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({ code: "rule_violation", rule: "options_frozen" });
      expect(await dbState(active.id)).toEqual(before);
    });

    it("refuses an option the product type does not allow", async () => {
      const draft = await productIn("draft");
      const result = await addValue(draft.id, fx.foreign, fx.foreign.values.f1);
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([{ path: "optionId", code: "option_not_allowed" }]);
    });

    it("refuses a value that is already chosen", async () => {
      const active = await productIn("active");
      const result = await addValue(active.id, fx.color, fx.color.values.red);
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([{ path: "valueId", code: "duplicate_value" }]);
    });

    it("rejects unknown values, values of another option and a malformed body", async () => {
      const active = await productIn("active");
      const unknown = await addValue(active.id, fx.color, MISSING_ID);
      expect(unknown.status).toBe(400);
      expect(problem(unknown).errors).toEqual([
        expect.objectContaining({ path: "valueId", code: "invalid_reference" }),
      ]);
      const otherOption = await addValue(active.id, fx.color, fx.size.values.l);
      expect(otherOption.status).toBe(400);
      expect(problem(otherOption).errors).toEqual([
        expect.objectContaining({ path: "valueId", code: "invalid_reference" }),
      ]);
      const malformed = await addValue(active.id, fx.color, "nope");
      expect(malformed.status).toBe(400);
      expect(problem(malformed).errors?.[0]?.path).toBe("valueId");
      const extra = await call(
        "POST",
        `/admin/products/${active.id}/options/${fx.color.id}/values`,
        {
          valueId: fx.color.values.green,
          more: true,
        },
      );
      expect(extra.status).toBe(400);
    });

    it("answers 404 for an unknown product or option and 400 for malformed ids", async () => {
      const active = await productIn("active");
      expect((await addValue(MISSING_ID, fx.color, fx.color.values.green)).status).toBe(404);
      const unknownOption = await call(
        "POST",
        `/admin/products/${active.id}/options/${MISSING_ID}/values`,
        { valueId: fx.color.values.green },
      );
      expect(unknownOption.status).toBe(404);
      expect(problem(unknownOption).code).toBe("not_found");
      const malformed = await call(
        "POST",
        `/admin/products/${active.id}/options/not-a-uuid/values`,
        { valueId: fx.color.values.green },
      );
      expect(malformed.status).toBe(400);
    });

    it("respects the 250-variant limit and rolls the new value back", async () => {
      const product = await createProduct();
      await okPut(
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
      const before = await dbState(product.id);
      expect(before.variants).toHaveLength(250);
      const result = await addValue(product.id, fx.biga, fx.biga.values.a26);
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "variants", code: "too_many_variants_total" }),
      ]);
      expect(await dbState(product.id)).toEqual(before);
    });
  });
});

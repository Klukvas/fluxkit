import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Page } from "../../../common/pagination.js";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import { ProductsRepository } from "./products.repository.js";
import type { ProductDetailResponse, ProductResponse } from "./products.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

type Status = "draft" | "active" | "archived";
type Action = "publish" | "unpublish" | "archive" | "restore";

interface Created {
  id: string;
  code?: string;
}

describe("admin products API (real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const created = {
    attributes: [] as string[],
    options: [] as string[],
    productTypes: [] as string[],
    categories: [] as string[],
    brands: [] as string[],
    products: [] as string[],
  };
  let running: RunningApp;
  let counter = 0;

  // Fixtures, created through the HTTP API in beforeAll.
  const codes = {
    material: `mat_${runId}`,
    care: `care_${runId}`,
    note: `note_${runId}`,
    supplier: `sup_${runId}`,
    color: `color_${runId}`,
    size: `size_${runId}`,
  };
  let teeTypeId = "";
  let gadgetTypeId = "";
  let colorOptionId = "";
  let sizeOptionId = "";
  const colorValueIds: Record<"red" | "blue", string> = { red: "", blue: "" };
  let sizeValueId = "";

  function uniqueTitle(prefix = "Футболка"): { uk: string; en: string } {
    counter += 1;
    return { uk: `${prefix} ${runId} ${counter}`, en: `Tee ${runId} ${counter}` };
  }

  async function call<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ) {
    return http<T>(running.baseUrl, method, path, { body });
  }

  async function fixture(path: string, body: unknown): Promise<Created> {
    const result = await call<Created>("POST", path, body);
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  async function createProduct(
    overrides: Record<string, unknown> = {},
  ): Promise<ProductDetailResponse> {
    const result = await call<ProductDetailResponse>("POST", "/admin/products", {
      productTypeId: teeTypeId,
      title: uniqueTitle(),
      ...overrides,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    created.products.push(result.body.id);
    return result.body;
  }

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  async function lifecycle(id: string, action: Action) {
    return call<ProductDetailResponse>("POST", `/admin/products/${id}/${action}`);
  }

  async function getProduct(id: string): Promise<ProductDetailResponse> {
    const result = await call<ProductDetailResponse>("GET", `/admin/products/${id}`);
    expect(result.status).toBe(200);
    return result.body;
  }

  /** A product that is publishable (its required attribute is set), moved to `status` through the API. */
  async function productIn(status: Status): Promise<ProductDetailResponse> {
    const product = await createProduct({ attributes: { [codes.material]: "cotton" } });
    if (status === "draft") {
      return product;
    }
    expect((await lifecycle(product.id, "publish")).status).toBe(200);
    if (status === "active") {
      return getProduct(product.id);
    }
    expect((await lifecycle(product.id, "archive")).status).toBe(200);
    return getProduct(product.id);
  }

  async function newCategory(): Promise<string> {
    const category = await fixture("/admin/categories", { name: uniqueTitle("Категорія") });
    created.categories.push(category.id);
    return category.id;
  }

  async function variantCount(productId: string): Promise<number> {
    const result = await pool.query(
      "select count(*)::int as count from variant where product_id = $1",
      [productId],
    );
    return result.rows[0].count;
  }

  /** Gives the product the color option with the red value (what the 4d-2 option routes will do). */
  async function chooseColorRed(productId: string): Promise<void> {
    await pool.query("insert into product_option (product_id, option_id) values ($1, $2)", [
      productId,
      colorOptionId,
    ]);
    await pool.query(
      "insert into product_option_value (product_id, option_id, option_value_id) values ($1, $2, $3)",
      [productId, colorOptionId, colorValueIds.red],
    );
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();

    const material = await fixture("/admin/attributes", {
      code: codes.material,
      name: { uk: "Матеріал" },
      inputType: "select",
    });
    created.attributes.push(material.id);
    for (const code of ["cotton", "linen"]) {
      const result = await call("POST", `/admin/attributes/${material.id}/options`, {
        code,
        label: { uk: code },
      });
      expect(result.status).toBe(201);
    }
    const care = await fixture("/admin/attributes", {
      code: codes.care,
      name: { uk: "Догляд" },
      inputType: "text",
    });
    const note = await fixture("/admin/attributes", {
      code: codes.note,
      name: { uk: "Службова примітка" },
      inputType: "text",
      isLocalized: false,
      isInternal: true,
    });
    const supplier = await fixture("/admin/attributes", {
      code: codes.supplier,
      name: { uk: "Постачальник" },
      inputType: "text",
      isLocalized: false,
    });
    created.attributes.push(care.id, note.id, supplier.id);

    const color = await fixture("/admin/options", { code: codes.color, name: { uk: "Колір" } });
    const size = await fixture("/admin/options", { code: codes.size, name: { uk: "Розмір" } });
    created.options.push(color.id, size.id);
    colorOptionId = color.id;
    sizeOptionId = size.id;
    for (const code of ["red", "blue"] as const) {
      colorValueIds[code] = (
        await fixture(`/admin/options/${color.id}/values`, { code, label: { uk: code } })
      ).id;
    }
    sizeValueId = (
      await fixture(`/admin/options/${size.id}/values`, { code: "m", label: { uk: "M" } })
    ).id;

    const tee = await fixture("/admin/product-types", {
      code: `tee_${runId}`,
      name: { uk: "Футболка" },
    });
    const gadget = await fixture("/admin/product-types", {
      code: `gadget_${runId}`,
      name: { uk: "Гаджет" },
    });
    teeTypeId = tee.id;
    gadgetTypeId = gadget.id;
    created.productTypes.push(tee.id, gadget.id);
    const assign = async (typeId: string, attributeId: string, body: unknown) => {
      const result = await call(
        "PUT",
        `/admin/product-types/${typeId}/attributes/${attributeId}`,
        body,
      );
      expect(result.status).toBeLessThan(300);
    };
    await assign(tee.id, material.id, { level: "product", isRequired: true });
    await assign(tee.id, care.id, { level: "product" });
    await assign(tee.id, note.id, { level: "product" });
    await assign(gadget.id, supplier.id, { level: "variant", isRequired: true });
    expect(
      (await call("PUT", `/admin/product-types/${tee.id}/options/${color.id}`, {})).status,
    ).toBe(201);
  });

  afterAll(async () => {
    await running.app.close();
    // Products first (cascade to variants, options, categories, media), then what they referenced.
    await pool.query(
      "delete from product where id = any($1::uuid[]) or product_type_id = any($2::uuid[])",
      [created.products, created.productTypes],
    );
    await pool.query("delete from brand where id = any($1::uuid[])", [created.brands]);
    await pool.query("delete from category where id = any($1::uuid[])", [created.categories]);
    await pool.query("delete from product_type where id = any($1::uuid[])", [created.productTypes]);
    await pool.query("delete from attribute where id = any($1::uuid[])", [created.attributes]);
    await pool.query("delete from option where id = any($1::uuid[])", [created.options]);
    await pool.end();
  });

  describe("POST /admin/products", () => {
    describe("retries of a slug or SKU the service proposed", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      function spyOnInserts() {
        return vi.spyOn(running.app.get(ProductsRepository), "insertProduct");
      }

      it("answers 409 at once, without a retry, for an explicit slug that is taken", async () => {
        const existing = await createProduct({ slug: `fast-${runId}` });
        const inserts = spyOnInserts();
        const result = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          slug: existing.slug,
        });
        expect(result.status).toBe(409);
        expect(problem(result)).toMatchObject({ field: "slug", constraint: "product_slug_key" });
        expect(inserts).toHaveBeenCalledTimes(1);
      });

      it("proposes another SKU after losing a race for one, and succeeds", async () => {
        const other = await createProduct({ slug: `sku-other-${runId}` });
        // Another request takes the SKU that the next product would get, between the lookup and the insert.
        await pool.query("update variant set sku = $1 where product_id = $2", [
          `SKU-NEW-${runId}`.toUpperCase(),
          other.id,
        ]);
        const repository = running.app.get(ProductsRepository);
        const inserts = spyOnInserts();
        // The first lookup does not see the taken SKU (the race); later lookups are real.
        vi.spyOn(repository, "findSkusStartingWith").mockResolvedValueOnce(new Set());
        const result = await call<ProductDetailResponse>("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          slug: `sku-new-${runId}`,
        });
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        created.products.push(result.body.id);
        expect(inserts).toHaveBeenCalledTimes(2);
        expect(result.body.variants[0]?.sku).not.toBe(`SKU-NEW-${runId}`.toUpperCase());
      });

      it("stops with 409 when a retry would propose the same SKU again", async () => {
        const other = await createProduct({ slug: `same-other-${runId}` });
        await pool.query("update variant set sku = $1 where product_id = $2", [
          `SAME-NEW-${runId}`.toUpperCase(),
          other.id,
        ]);
        const inserts = spyOnInserts();
        // The lookup never sees the taken SKU, so every attempt proposes the colliding one.
        vi.spyOn(running.app.get(ProductsRepository), "findSkusStartingWith").mockResolvedValue(
          new Set(),
        );
        const result = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          slug: `same-new-${runId}`,
        });
        expect(result.status).toBe(409);
        expect(inserts).toHaveBeenCalledTimes(2);
      });

      it("stops with 409 when a retry would generate the same slug again", async () => {
        const title = { uk: `Repeat ${runId}` };
        await createProduct({ title });
        const inserts = spyOnInserts();
        vi.spyOn(running.app.get(ProductsRepository), "findSlugsStartingWith").mockResolvedValue(
          new Set(),
        );
        const result = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title,
        });
        expect(result.status).toBe(409);
        expect(problem(result)).toMatchObject({ field: "slug" });
        expect(inserts).toHaveBeenCalledTimes(2);
      });
    });

    it("generates distinct slugs of at most 160 characters for the same 200 character title", async () => {
      const title = { uk: `${runId}${"a".repeat(192)}` };
      const slugs: string[] = [];
      for (let round = 0; round < 4; round += 1) {
        slugs.push((await createProduct({ title })).slug);
      }
      const base = `${runId}${"a".repeat(152)}`;
      expect(slugs).toEqual([
        base,
        `${base.slice(0, 158)}-2`,
        `${base.slice(0, 158)}-3`,
        `${base.slice(0, 158)}-4`,
      ]);
      for (const slug of slugs) {
        expect(slug.length).toBeLessThanOrEqual(160);
      }
    });

    it("creates a draft with its default variant, generates the slug and sets Location", async () => {
      const title = uniqueTitle();
      const result = await call<ProductDetailResponse>("POST", "/admin/products", {
        productTypeId: teeTypeId,
        title,
      });
      created.products.push(result.body.id);
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(`/admin/products/${result.body.id}`);
      const slug = `futbolka-${runId}-${counter}`;
      expect(result.body).toEqual({
        id: expect.stringMatching(UUID),
        productTypeId: teeTypeId,
        brandId: null,
        slug,
        title,
        description: null,
        status: "draft",
        attributes: {},
        publishedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        categories: [],
        media: [],
        options: [],
        variants: [
          {
            id: expect.stringMatching(UUID),
            sku: slug.toUpperCase(),
            barcode: null,
            title: null,
            optionSignature: "",
            isDefault: true,
            isActive: true,
            attributes: {},
            position: 0,
            optionValues: [],
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        ],
      });
    });

    it("creates exactly one variant and it is the default one (checked in the database)", async () => {
      const product = await createProduct();
      const rows = await pool.query(
        "select is_default, is_active, option_signature from variant where product_id = $1",
        [product.id],
      );
      expect(rows.rows).toEqual([{ is_default: true, is_active: true, option_signature: "" }]);
      expect(await variantCount(product.id)).toBe(1);
    });

    it("romanizes a Ukrainian title and stores description, brand and an explicit slug as given", async () => {
      const romanized = await createProduct({ title: { uk: `Чоловічий одяг ${runId}` } });
      expect(romanized.slug).toBe(`cholovichyi-odiah-${runId}`);

      const brand = await fixture("/admin/brands", { name: uniqueTitle("Бренд") });
      created.brands.push(brand.id);
      const explicit = await createProduct({
        slug: `custom-${runId}`,
        description: { uk: "Опис", en: "Description" },
        brandId: brand.id,
      });
      expect(explicit).toMatchObject({
        slug: `custom-${runId}`,
        brandId: brand.id,
        description: { uk: "Опис", en: "Description" },
      });
      expect(explicit.variants[0]?.sku).toBe(`CUSTOM-${runId}`.toUpperCase());
    });

    it("stores an empty description map as no description", async () => {
      expect((await createProduct({ description: {} })).description).toBeNull();
    });

    it("stores product-level attribute values, internal ones included (this is the admin API)", async () => {
      const attributes = {
        [codes.material]: "linen",
        [codes.care]: { uk: "Прати при 30", en: "Wash at 30" },
        [codes.note]: "supplier only",
      };
      const product = await createProduct({ attributes });
      expect(product.attributes).toEqual(attributes);
      expect((await getProduct(product.id)).attributes).toEqual(attributes);
    });

    it("allows a draft without its required attributes (they are enforced on publish)", async () => {
      const product = await createProduct({ attributes: {} });
      expect(product.status).toBe("draft");
    });

    it("creates a product of a type that allows options without any option", async () => {
      const product = await createProduct();
      expect(product.options).toEqual([]);
      expect(product.variants).toHaveLength(1);
    });

    it("avoids a SKU that is already taken by another variant", async () => {
      const other = await createProduct();
      await pool.query("update variant set sku = $1 where product_id = $2", [
        `CLASH-${runId}`.toUpperCase(),
        other.id,
      ]);
      const product = await createProduct({ slug: `clash-${runId}` });
      expect(product.variants[0]?.sku).toBe(`CLASH-${runId}-2`.toUpperCase());
    });

    it("gives concurrent creates with the same title distinct slugs and SKUs", async () => {
      const title = uniqueTitle("Паралельний");
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          call<ProductDetailResponse>("POST", "/admin/products", {
            productTypeId: teeTypeId,
            title,
          }),
        ),
      );
      for (const result of results) {
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        created.products.push(result.body.id);
      }
      const slugs = results.map((result) => result.body.slug).sort();
      const base = `paralelnyi-${runId}-${counter}`;
      expect(slugs).toEqual([base, `${base}-2`, `${base}-3`, `${base}-4`, `${base}-5`]);
      const skus = results.map((result) => result.body.variants[0]?.sku);
      expect(new Set(skus).size).toBe(5);
      for (const result of results) {
        expect(await variantCount(result.body.id)).toBe(1);
      }
    });

    it("answers 409 conflict for an explicit slug that is taken", async () => {
      const first = await createProduct({ slug: `taken-${runId}` });
      const second = await call("POST", "/admin/products", {
        productTypeId: teeTypeId,
        title: uniqueTitle(),
        slug: first.slug,
      });
      expect(second.status).toBe(409);
      expect(problem(second)).toMatchObject({
        code: "conflict",
        field: "slug",
        constraint: "product_slug_key",
      });
    });

    it("leaves nothing behind when the request fails after validation (no product without a variant)", async () => {
      const before = await pool.query(
        "select count(*)::int as count from product where product_type_id = $1",
        [teeTypeId],
      );
      const failed = await call("POST", "/admin/products", {
        productTypeId: teeTypeId,
        title: uniqueTitle(),
        attributes: { nope: 1 },
      });
      expect(failed.status).toBe(400);
      const after = await pool.query(
        "select count(*)::int as count from product where product_type_id = $1",
        [teeTypeId],
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    describe("validation (400)", () => {
      const errorsOf = (result: { body: unknown }) => problem(result).errors;

      it("requires productTypeId and title", async () => {
        const result = await call("POST", "/admin/products", {});
        expect(result.status).toBe(400);
        expect(errorsOf(result)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "productTypeId", code: "required" }),
            expect.objectContaining({ path: "title", code: "required" }),
          ]),
        );
      });

      it("rejects unknown fields such as status", async () => {
        const result = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          status: "active",
        });
        expect(result.status).toBe(400);
        expect(errorsOf(result)).toEqual([{ path: "status", code: "unknown_field" }]);
      });

      it("rejects a title without the default locale or with an unknown locale", async () => {
        const result = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: { fr: "Bonjour" },
        });
        expect(result.status).toBe(400);
        expect(errorsOf(result)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "title.fr", code: "locale_not_allowed" }),
            expect.objectContaining({ path: "title.uk", code: "default_locale_missing" }),
          ]),
        );
      });

      it("rejects an empty title map and a too long title", async () => {
        const empty = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: {},
        });
        expect(empty.status).toBe(400);
        expect(errorsOf(empty)).toEqual([
          expect.objectContaining({ path: "title", code: "required" }),
        ]);
        const long = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: { uk: "я".repeat(256) },
        });
        expect(long.status).toBe(400);
        expect(errorsOf(long)).toEqual([
          expect.objectContaining({ path: "title.uk", code: "too_long" }),
        ]);
      });

      it("rejects an invalid slug and a title that cannot produce one", async () => {
        const invalid = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          slug: "Not A Slug",
        });
        expect(invalid.status).toBe(400);
        expect(errorsOf(invalid)).toEqual([expect.objectContaining({ path: "slug" })]);
        const empty = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: { uk: "!!!" },
        });
        expect(empty.status).toBe(400);
        expect(errorsOf(empty)).toEqual([
          expect.objectContaining({ path: "slug", code: "empty_slug" }),
        ]);
      });

      it("rejects a malformed or unknown productTypeId and brandId", async () => {
        const malformed = await call("POST", "/admin/products", {
          productTypeId: "nope",
          title: uniqueTitle(),
        });
        expect(malformed.status).toBe(400);
        expect(errorsOf(malformed)).toEqual([expect.objectContaining({ path: "productTypeId" })]);
        const unknownType = await call("POST", "/admin/products", {
          productTypeId: MISSING_ID,
          title: uniqueTitle(),
        });
        expect(unknownType.status).toBe(400);
        expect(errorsOf(unknownType)).toEqual([
          { path: "productTypeId", code: "invalid_reference" },
        ]);
        const unknownBrand = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          brandId: MISSING_ID,
        });
        expect(unknownBrand.status).toBe(400);
        expect(errorsOf(unknownBrand)).toEqual([{ path: "brandId", code: "invalid_reference" }]);
      });

      it("rejects unknown attribute codes, null values, wrong types and unknown select options", async () => {
        const result = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          attributes: {
            nope: 1,
            [codes.material]: 5,
            [codes.care]: null,
          },
        });
        expect(result.status).toBe(400);
        expect(errorsOf(result)).toEqual(
          expect.arrayContaining([
            { path: "attributes.nope", code: "unknown_attribute" },
            { path: `attributes.${codes.material}`, code: "invalid_type" },
            { path: `attributes.${codes.care}`, code: "null_value" },
          ]),
        );
        const unknownOption = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          attributes: { [codes.material]: "silk" },
        });
        expect(unknownOption.status).toBe(400);
        expect(errorsOf(unknownOption)).toEqual([
          { path: `attributes.${codes.material}`, code: "unknown_option" },
        ]);
      });

      it("rejects attributes of the variant level and a non-object attributes value", async () => {
        const variantLevel = await call("POST", "/admin/products", {
          productTypeId: gadgetTypeId,
          title: uniqueTitle(),
          attributes: { [codes.supplier]: "S-1" },
        });
        expect(variantLevel.status).toBe(400);
        expect(errorsOf(variantLevel)).toEqual([
          { path: `attributes.${codes.supplier}`, code: "unknown_attribute" },
        ]);
        const notObject = await call("POST", "/admin/products", {
          productTypeId: teeTypeId,
          title: uniqueTitle(),
          attributes: [],
        });
        expect(notObject.status).toBe(400);
        expect(errorsOf(notObject)).toEqual([expect.objectContaining({ path: "attributes" })]);
      });
    });
  });

  describe("GET /admin/products and /:id", () => {
    it("returns the product with categories, media, variants and the options as stored", async () => {
      const product = await createProduct();
      await chooseColorRed(product.id);
      const categoryId = await newCategory();
      await call("PUT", `/admin/products/${product.id}/categories`, {
        categories: [{ categoryId }],
      });
      await call("PUT", `/admin/products/${product.id}/media`, {
        media: [{ url: "https://cdn.example.test/a.png" }],
      });
      const detail = await getProduct(product.id);
      expect(detail.categories).toEqual([{ categoryId, isPrimary: true, position: 0 }]);
      expect(detail.media).toHaveLength(1);
      expect(detail.variants).toHaveLength(1);
      expect(detail.options).toEqual([
        {
          optionId: colorOptionId,
          optionCode: codes.color,
          position: 0,
          values: [{ optionValueId: colorValueIds.red, valueCode: "red", position: 0 }],
        },
      ]);
    });

    it("answers 404 for an unknown product and 400 for a malformed id", async () => {
      const missing = await call("GET", `/admin/products/${MISSING_ID}`);
      expect(missing.status).toBe(404);
      expect(problem(missing)).toMatchObject({ code: "not_found" });
      const malformed = await call("GET", "/admin/products/not-a-uuid");
      expect(malformed.status).toBe(400);
      expect(problem(malformed).errors).toEqual([expect.objectContaining({ path: "id" })]);
    });

    it("lists with status, brand and category filters and paginates in slug order", async () => {
      const brand = await fixture("/admin/brands", { name: uniqueTitle("Бренд") });
      created.brands.push(brand.id);
      const categoryId = await newCategory();
      const a = await createProduct({ slug: `list-a-${runId}`, brandId: brand.id });
      const b = await createProduct({
        slug: `list-b-${runId}`,
        brandId: brand.id,
        attributes: { [codes.material]: "cotton" },
      });
      const c = await createProduct({ slug: `list-c-${runId}`, brandId: brand.id });
      expect((await lifecycle(b.id, "publish")).status).toBe(200);
      await call("PUT", `/admin/products/${c.id}/categories`, { categories: [{ categoryId }] });

      const all = await call<Page<ProductResponse>>("GET", `/admin/products?brandId=${brand.id}`);
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ total: 3, limit: 50, offset: 0 });
      expect(all.body.items.map((item) => item.id)).toEqual([a.id, b.id, c.id]);

      const active = await call<Page<ProductResponse>>(
        "GET",
        `/admin/products?brandId=${brand.id}&status=active`,
      );
      expect(active.body.items.map((item) => item.id)).toEqual([b.id]);
      const drafts = await call<Page<ProductResponse>>(
        "GET",
        `/admin/products?brandId=${brand.id}&status=draft`,
      );
      expect(drafts.body.total).toBe(2);
      const inCategory = await call<Page<ProductResponse>>(
        "GET",
        `/admin/products?categoryId=${categoryId}`,
      );
      expect(inCategory.body.items.map((item) => item.id)).toEqual([c.id]);

      const page = await call<Page<ProductResponse>>(
        "GET",
        `/admin/products?brandId=${brand.id}&limit=1&offset=1`,
      );
      expect(page.body).toMatchObject({ total: 3, limit: 1, offset: 1 });
      expect(page.body.items.map((item) => item.id)).toEqual([b.id]);
      expect(page.body.items[0]).not.toHaveProperty("variants");
    });

    it("rejects an invalid status filter and out-of-range pagination", async () => {
      const status = await call("GET", "/admin/products?status=deleted");
      expect(status.status).toBe(400);
      expect(problem(status).errors).toEqual([expect.objectContaining({ path: "status" })]);
      expect((await call("GET", "/admin/products?limit=101")).status).toBe(400);
      expect((await call("GET", "/admin/products?offset=10001")).status).toBe(400);
      expect((await call("GET", "/admin/products?categoryId=nope")).status).toBe(400);
    });
  });

  describe("PATCH /admin/products/:id", () => {
    it("changes only the listed fields", async () => {
      const product = await createProduct({ description: { uk: "Опис" } });
      const title = { uk: `Нова назва ${runId}`, en: "New title" };
      const result = await call<ProductDetailResponse>("PATCH", `/admin/products/${product.id}`, {
        title,
        slug: `patched-${runId}`,
      });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        title,
        slug: `patched-${runId}`,
        description: { uk: "Опис" },
        status: "draft",
      });
      expect(result.body.variants).toHaveLength(1);
    });

    it("answers 400, not 500, for a deeply nested attribute value", async () => {
      const product = await createProduct();
      const deep = `${"[".repeat(50_000)}"x"${"]".repeat(50_000)}`;
      const result = await http(running.baseUrl, "PATCH", `/admin/products/${product.id}`, {
        rawBody: `{"attributes":{"${codes.note}":${deep}}}`,
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        { path: `attributes.${codes.note}`, code: "invalid_type" },
      ]);
      const created = await http(running.baseUrl, "POST", "/admin/products", {
        rawBody: `{"productTypeId":"${teeTypeId}","title":{"uk":"Deep ${runId}"},"attributes":{"${codes.note}":${deep}}}`,
      });
      expect(created.status).toBe(400);
    });

    it("clears the description and the brand with null, and sets a brand", async () => {
      const brand = await fixture("/admin/brands", { name: uniqueTitle("Бренд") });
      created.brands.push(brand.id);
      const product = await createProduct({ description: { uk: "Опис" } });
      const set = await call<ProductDetailResponse>("PATCH", `/admin/products/${product.id}`, {
        brandId: brand.id,
      });
      expect(set.body.brandId).toBe(brand.id);
      const cleared = await call<ProductDetailResponse>("PATCH", `/admin/products/${product.id}`, {
        brandId: null,
        description: null,
      });
      expect(cleared.body).toMatchObject({ brandId: null, description: null });
    });

    it("replaces the attributes map and validates it like create", async () => {
      const product = await createProduct({ attributes: { [codes.material]: "cotton" } });
      const replaced = await call<ProductDetailResponse>("PATCH", `/admin/products/${product.id}`, {
        attributes: { [codes.material]: "linen" },
      });
      expect(replaced.body.attributes).toEqual({ [codes.material]: "linen" });
      const invalid = await call("PATCH", `/admin/products/${product.id}`, {
        attributes: { [codes.material]: "silk", nope: true },
      });
      expect(invalid.status).toBe(400);
      expect(problem(invalid).errors).toEqual(
        expect.arrayContaining([
          { path: `attributes.${codes.material}`, code: "unknown_option" },
          { path: "attributes.nope", code: "unknown_attribute" },
        ]),
      );
      expect((await getProduct(product.id)).attributes).toEqual({ [codes.material]: "linen" });
    });

    it("returns the product unchanged for an empty body", async () => {
      const product = await createProduct();
      const result = await call<ProductDetailResponse>(
        "PATCH",
        `/admin/products/${product.id}`,
        {},
      );
      expect(result.status).toBe(200);
      expect(result.body.updatedAt).toBe(product.updatedAt);
    });

    it("rejects unknown fields (status, code) and malformed values", async () => {
      const product = await createProduct();
      const status = await call("PATCH", `/admin/products/${product.id}`, { status: "active" });
      expect(status.status).toBe(400);
      expect(problem(status).errors).toEqual([{ path: "status", code: "unknown_field" }]);
      const title = await call("PATCH", `/admin/products/${product.id}`, { title: { fr: "x" } });
      expect(title.status).toBe(400);
      const slug = await call("PATCH", `/admin/products/${product.id}`, { slug: "UPPER" });
      expect(slug.status).toBe(400);
      const brand = await call("PATCH", `/admin/products/${product.id}`, { brandId: MISSING_ID });
      expect(brand.status).toBe(400);
      expect(problem(brand).errors).toEqual([{ path: "brandId", code: "invalid_reference" }]);
    });

    it("keeps the product type: a different one is 409 rule_violation, the same one is accepted", async () => {
      const product = await createProduct();
      const other = await call("PATCH", `/admin/products/${product.id}`, {
        productTypeId: gadgetTypeId,
      });
      expect(other.status).toBe(409);
      expect(problem(other)).toMatchObject({
        code: "rule_violation",
        rule: "product_type_immutable",
      });
      const same = await call<ProductDetailResponse>("PATCH", `/admin/products/${product.id}`, {
        productTypeId: teeTypeId,
      });
      expect(same.status).toBe(200);
      expect((await getProduct(product.id)).productTypeId).toBe(teeTypeId);
    });

    it("answers 409 conflict when the slug is taken", async () => {
      const first = await createProduct();
      const second = await createProduct();
      const result = await call("PATCH", `/admin/products/${second.id}`, { slug: first.slug });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({
        code: "conflict",
        field: "slug",
        constraint: "product_slug_key",
      });
    });

    it("answers 404 for an unknown product", async () => {
      const result = await call("PATCH", `/admin/products/${MISSING_ID}`, { slug: "x" });
      expect(result.status).toBe(404);
    });
  });

  describe("DELETE /admin/products/:id", () => {
    it("deletes a never-published product with its variant, then answers 404", async () => {
      const product = await createProduct();
      const deleted = await call("DELETE", `/admin/products/${product.id}`);
      expect(deleted.status).toBe(204);
      expect((await call("GET", `/admin/products/${product.id}`)).status).toBe(404);
      expect(await variantCount(product.id)).toBe(0);
      expect((await call("DELETE", `/admin/products/${product.id}`)).status).toBe(404);
    });

    it("deletes a never-published archived product", async () => {
      const product = await createProduct();
      expect((await lifecycle(product.id, "archive")).status).toBe(200);
      expect((await call("DELETE", `/admin/products/${product.id}`)).status).toBe(204);
    });

    it("answers 409 rule_violation for a product that was published, even after unpublish", async () => {
      const product = await productIn("active");
      const active = await call("DELETE", `/admin/products/${product.id}`);
      expect(active.status).toBe(409);
      expect(problem(active)).toMatchObject({
        code: "rule_violation",
        rule: "product_was_published",
      });
      expect((await lifecycle(product.id, "unpublish")).status).toBe(200);
      expect((await call("DELETE", `/admin/products/${product.id}`)).status).toBe(409);
      expect((await getProduct(product.id)).status).toBe("draft");
      expect(await variantCount(product.id)).toBe(1);
    });

    it("deletes a draft together with its options, option values, categories and media", async () => {
      const product = await createProduct();
      await chooseColorRed(product.id);
      const categoryId = await newCategory();
      expect(
        (
          await call("PUT", `/admin/products/${product.id}/categories`, {
            categories: [{ categoryId }],
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call("PUT", `/admin/products/${product.id}/media`, {
            media: [
              {
                url: "https://cdn.example.test/red.png",
                optionId: colorOptionId,
                optionValueId: colorValueIds.red,
              },
            ],
          })
        ).status,
      ).toBe(200);
      expect((await call("DELETE", `/admin/products/${product.id}`)).status).toBe(204);
      for (const table of ["product_option_value", "product_option", "product_category", "media"]) {
        const rows = await pool.query(
          `select count(*)::int as count from ${table} where product_id = $1`,
          [product.id],
        );
        expect(rows.rows[0].count, table).toBe(0);
      }
    });

    it("answers 404 for an unknown product", async () => {
      expect((await call("DELETE", `/admin/products/${MISSING_ID}`)).status).toBe(404);
    });
  });

  describe("lifecycle", () => {
    const legal: [Status, Action, Status][] = [
      ["draft", "publish", "active"],
      ["draft", "archive", "archived"],
      ["active", "unpublish", "draft"],
      ["active", "archive", "archived"],
      ["archived", "restore", "draft"],
    ];
    const illegal: [Status, Action, Status][] = [
      ["draft", "unpublish", "draft"],
      ["draft", "restore", "draft"],
      ["active", "publish", "active"],
      ["active", "restore", "draft"],
      ["archived", "publish", "active"],
      ["archived", "unpublish", "draft"],
      ["archived", "archive", "archived"],
    ];

    it.each(legal)(
      "%s product: %s answers 200 and the product becomes %s",
      async (from, action, to) => {
        const product = await productIn(from);
        const result = await lifecycle(product.id, action);
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        expect(result.body.status).toBe(to);
        expect((await getProduct(product.id)).status).toBe(to);
      },
    );

    it.each(illegal)(
      "%s product: %s answers 409 invalid_transition and changes nothing",
      async (from, action, target) => {
        const product = await productIn(from);
        const result = await lifecycle(product.id, action);
        expect(result.status).toBe(409);
        expect(problem(result)).toMatchObject({
          code: "invalid_transition",
          rule: `${from}_to_${target}`,
        });
        const after = await getProduct(product.id);
        expect(after.status).toBe(from);
        expect(after.publishedAt).toBe(product.publishedAt);
      },
    );

    it("answers 404 for an unknown product on every action", async () => {
      for (const action of ["publish", "unpublish", "archive", "restore"] as const) {
        expect((await lifecycle(MISSING_ID, action)).status, action).toBe(404);
      }
    });

    it("sets publishedAt on the first publish and never moves or clears it", async () => {
      const product = await productIn("draft");
      expect(product.publishedAt).toBeNull();
      const first = await lifecycle(product.id, "publish");
      expect(first.body.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      await lifecycle(product.id, "unpublish");
      expect((await getProduct(product.id)).publishedAt).toBe(first.body.publishedAt);
      await lifecycle(product.id, "archive");
      await lifecycle(product.id, "restore");
      const again = await lifecycle(product.id, "publish");
      expect(again.status).toBe(200);
      expect(again.body.publishedAt).toBe(first.body.publishedAt);
    });

    describe("publish preconditions", () => {
      it("blocks publishing without the required attribute, then allows it after the fix", async () => {
        const product = await createProduct();
        const blocked = await lifecycle(product.id, "publish");
        expect(blocked.status).toBe(400);
        expect(problem(blocked)).toMatchObject({ code: "validation_failed" });
        expect(problem(blocked).errors).toEqual([
          { path: `attributes.${codes.material}`, code: "required" },
        ]);
        const unchanged = await getProduct(product.id);
        expect(unchanged.status).toBe("draft");
        expect(unchanged.publishedAt).toBeNull();

        const fixed = await call("PATCH", `/admin/products/${product.id}`, {
          attributes: { [codes.material]: "cotton" },
        });
        expect(fixed.status).toBe(200);
        const published = await lifecycle(product.id, "publish");
        expect(published.status).toBe(200);
        expect(published.body.status).toBe("active");
      });

      it("reports a required variant-level attribute per variant until it is set", async () => {
        const product = await createProduct({ productTypeId: gadgetTypeId });
        const blocked = await lifecycle(product.id, "publish");
        expect(blocked.status).toBe(400);
        expect(problem(blocked).errors).toEqual([
          expect.objectContaining({
            path: `variants.0.attributes.${codes.supplier}`,
            code: "required",
          }),
        ]);
        await pool.query("update variant set attributes = $1::jsonb where product_id = $2", [
          JSON.stringify({ [codes.supplier]: "S-1" }),
          product.id,
        ]);
        expect((await lifecycle(product.id, "publish")).status).toBe(200);
      });

      it("returns every violation at once", async () => {
        const product = await createProduct();
        await pool.query("delete from variant where product_id = $1", [product.id]);
        await pool.query("update product set title = $1::jsonb where id = $2", [
          JSON.stringify({ en: "No default locale" }),
          product.id,
        ]);
        const blocked = await lifecycle(product.id, "publish");
        expect(blocked.status).toBe(400);
        expect(problem(blocked).errors).toEqual(
          expect.arrayContaining([
            { path: "title.uk", code: "default_locale_missing" },
            { path: `attributes.${codes.material}`, code: "required" },
            { path: "variants", code: "no_variants" },
          ]),
        );
      });

      it("rejects an inactive default variant", async () => {
        const product = await createProduct({ attributes: { [codes.material]: "cotton" } });
        await pool.query("update variant set is_active = false where product_id = $1", [
          product.id,
        ]);
        const blocked = await lifecycle(product.id, "publish");
        expect(blocked.status).toBe(400);
        expect(problem(blocked).errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "variants.0", code: "default_variant_inactive" }),
            expect.objectContaining({ path: "variants", code: "no_active_variant" }),
          ]),
        );
      });

      it("rejects a product whose option has no value on its variant or is not allowed by the type", async () => {
        const product = await createProduct({ attributes: { [codes.material]: "cotton" } });
        await chooseColorRed(product.id);
        await pool.query("insert into product_option (product_id, option_id) values ($1, $2)", [
          product.id,
          sizeOptionId,
        ]);
        const blocked = await lifecycle(product.id, "publish");
        expect(blocked.status).toBe(400);
        expect(problem(blocked).errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "variants.0", code: "missing_option_value" }),
            { path: `options.${codes.size}`, code: "option_not_allowed" },
          ]),
        );
      });

      it("enforces the required attributes on every write to an active product", async () => {
        const product = await productIn("active");
        const removed = await call("PATCH", `/admin/products/${product.id}`, { attributes: {} });
        expect(removed.status).toBe(400);
        expect(problem(removed).errors).toEqual([
          { path: `attributes.${codes.material}`, code: "required" },
        ]);
        const renamed = await call<ProductDetailResponse>(
          "PATCH",
          `/admin/products/${product.id}`,
          {
            title: { uk: `Інша назва ${runId}` },
          },
        );
        expect(renamed.status).toBe(200);
        expect((await getProduct(product.id)).attributes).toEqual({ [codes.material]: "cotton" });
      });

      it("runs the preconditions again when a restored product is published", async () => {
        const product = await productIn("archived");
        expect((await lifecycle(product.id, "restore")).status).toBe(200);
        await call("PATCH", `/admin/products/${product.id}`, {
          attributes: { [codes.material]: "linen" },
        });
        await pool.query("update variant set is_active = false where product_id = $1", [
          product.id,
        ]);
        const blocked = await lifecycle(product.id, "publish");
        expect(blocked.status).toBe(400);
        expect((await getProduct(product.id)).status).toBe("draft");
      });
    });
  });

  describe("PUT /admin/products/:id/categories", () => {
    async function put(productId: string, body: unknown) {
      return call<ProductDetailResponse>("PUT", `/admin/products/${productId}/categories`, body);
    }

    async function primaryCount(productId: string): Promise<number> {
      const rows = await pool.query(
        "select count(*)::int as count from product_category where product_id = $1 and is_primary",
        [productId],
      );
      return rows.rows[0].count;
    }

    it("makes the lowest position primary when no primary is given", async () => {
      const product = await createProduct();
      const [a, b] = [await newCategory(), await newCategory()];
      const result = await put(product.id, {
        categories: [
          { categoryId: a, position: 5 },
          { categoryId: b, position: 1 },
        ],
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.categories).toEqual([
        { categoryId: b, isPrimary: true, position: 1 },
        { categoryId: a, isPrimary: false, position: 5 },
      ]);
      expect(await primaryCount(product.id)).toBe(1);
    });

    it("uses the given primary and defaults positions to the list index", async () => {
      const product = await createProduct();
      const [a, b] = [await newCategory(), await newCategory()];
      const result = await put(product.id, {
        categories: [{ categoryId: a }, { categoryId: b }],
        primaryCategoryId: b,
      });
      expect(result.body.categories).toEqual([
        { categoryId: a, isPrimary: false, position: 0 },
        { categoryId: b, isPrimary: true, position: 1 },
      ]);
    });

    it("keeps the current primary while it is still assigned", async () => {
      const product = await createProduct();
      const [a, b] = [await newCategory(), await newCategory()];
      await put(product.id, {
        categories: [{ categoryId: a }, { categoryId: b }],
        primaryCategoryId: b,
      });
      const result = await put(product.id, { categories: [{ categoryId: a }, { categoryId: b }] });
      expect(result.body.categories.find((entry) => entry.isPrimary)?.categoryId).toBe(b);
      expect(await primaryCount(product.id)).toBe(1);
    });

    it("promotes the lowest position when the primary is removed", async () => {
      const product = await createProduct();
      const [a, b, c] = [await newCategory(), await newCategory(), await newCategory()];
      await put(product.id, {
        categories: [{ categoryId: a }, { categoryId: b }],
        primaryCategoryId: a,
      });
      const result = await put(product.id, {
        categories: [
          { categoryId: c, position: 7 },
          { categoryId: b, position: 2 },
        ],
      });
      expect(result.status).toBe(200);
      expect(result.body.categories).toEqual([
        { categoryId: b, isPrimary: true, position: 2 },
        { categoryId: c, isPrimary: false, position: 7 },
      ]);
      expect(await primaryCount(product.id)).toBe(1);
    });

    it("replaces the set and an empty list clears it", async () => {
      const product = await createProduct();
      const [a, b] = [await newCategory(), await newCategory()];
      await put(product.id, { categories: [{ categoryId: a }] });
      const replaced = await put(product.id, { categories: [{ categoryId: b }] });
      expect(replaced.body.categories.map((entry) => entry.categoryId)).toEqual([b]);
      const cleared = await put(product.id, { categories: [] });
      expect(cleared.status).toBe(200);
      expect(cleared.body.categories).toEqual([]);
    });

    it("rejects a duplicate category, a primary outside the list and unknown categories with 400", async () => {
      const product = await createProduct();
      const [a, b] = [await newCategory(), await newCategory()];
      const duplicate = await put(product.id, {
        categories: [{ categoryId: a }, { categoryId: a }],
      });
      expect(duplicate.status).toBe(400);
      expect(problem(duplicate).errors).toEqual([
        { path: "categories.1.categoryId", code: "duplicate_category" },
      ]);
      const primary = await put(product.id, {
        categories: [{ categoryId: a }],
        primaryCategoryId: b,
      });
      expect(primary.status).toBe(400);
      expect(problem(primary).errors).toEqual([
        { path: "primaryCategoryId", code: "primary_not_assigned" },
      ]);
      const unknown = await put(product.id, {
        categories: [{ categoryId: a }, { categoryId: MISSING_ID }],
      });
      expect(unknown.status).toBe(400);
      expect(problem(unknown).errors).toEqual([
        { path: "categories.1.categoryId", code: "invalid_reference" },
      ]);
      expect((await getProduct(product.id)).categories).toEqual([]);
    });

    it("rejects malformed bodies, unknown fields and too many categories", async () => {
      const product = await createProduct();
      expect((await put(product.id, {})).status).toBe(400);
      expect((await put(product.id, { categories: [{ categoryId: "nope" }] })).status).toBe(400);
      const extra = await put(product.id, { categories: [], extra: 1 });
      expect(extra.status).toBe(400);
      expect(problem(extra).errors).toEqual([{ path: "extra", code: "unknown_field" }]);
      const many = await put(product.id, {
        categories: Array.from({ length: 101 }, () => ({ categoryId: MISSING_ID })),
      });
      expect(many.status).toBe(400);
    });

    it("answers 404 for an unknown product and 400 for a malformed id", async () => {
      expect((await put(MISSING_ID, { categories: [] })).status).toBe(404);
      expect((await put("not-a-uuid", { categories: [] })).status).toBe(400);
    });
  });

  describe("PUT /admin/products/:id/media", () => {
    async function put(productId: string, body: unknown) {
      return call<ProductDetailResponse>("PUT", `/admin/products/${productId}/media`, body);
    }

    it.each([
      ["NUL", "\u0000"],
      ["a lone surrogate", "\ud800"],
    ])("answers 400, not 500, for %s in a url or an alt text", async (_name, bad) => {
      const product = await createProduct();
      const url = await put(product.id, {
        media: [{ url: `https://cdn.example.test/a${bad}.png` }],
      });
      expect(url.status, JSON.stringify(url.body)).toBe(400);
      expect(problem(url).errors).toContainEqual(expect.objectContaining({ path: "media.0.url" }));
      const alt = await put(product.id, {
        media: [{ url: "https://cdn.example.test/a.png", alt: { uk: `Фото${bad}` } }],
      });
      expect(alt.status, JSON.stringify(alt.body)).toBe(400);
      expect(problem(alt).errors).toContainEqual(
        expect.objectContaining({ path: "media.0.alt.uk" }),
      );
      expect((await getProduct(product.id)).media).toEqual([]);
    });

    it("replaces the list, defaults positions to the index and returns the items in order", async () => {
      const product = await createProduct();
      const first = await put(product.id, {
        media: [
          { url: "https://cdn.example.test/a.png", alt: { uk: "Фото", en: "Photo" } },
          { url: "http://cdn.example.test/b.png" },
          { url: "https://cdn.example.test/c.png", position: 10 },
        ],
      });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.media.map((item) => [item.url, item.position])).toEqual([
        ["https://cdn.example.test/a.png", 0],
        ["http://cdn.example.test/b.png", 1],
        ["https://cdn.example.test/c.png", 10],
      ]);
      expect(first.body.media[0]).toMatchObject({
        id: expect.stringMatching(UUID),
        alt: { uk: "Фото", en: "Photo" },
        optionId: null,
        optionValueId: null,
      });
      expect(first.body.media[1]?.alt).toBeNull();

      const second = await put(product.id, { media: [{ url: "https://cdn.example.test/z.png" }] });
      expect(second.body.media.map((item) => item.url)).toEqual(["https://cdn.example.test/z.png"]);
      const rows = await pool.query(
        "select count(*)::int as count from media where product_id = $1",
        [product.id],
      );
      expect(rows.rows[0].count).toBe(1);
      const cleared = await put(product.id, { media: [] });
      expect(cleared.body.media).toEqual([]);
    });

    it("links an image to an option value the product chose", async () => {
      const product = await createProduct();
      await chooseColorRed(product.id);
      const result = await put(product.id, {
        media: [
          {
            url: "https://cdn.example.test/red.png",
            optionId: colorOptionId,
            optionValueId: colorValueIds.red,
          },
          { url: "https://cdn.example.test/gallery.png", optionId: null, optionValueId: null },
        ],
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.media[0]).toMatchObject({
        optionId: colorOptionId,
        optionValueId: colorValueIds.red,
      });
      expect(result.body.media[1]).toMatchObject({ optionId: null, optionValueId: null });
    });

    it("rejects half an option pair with 400", async () => {
      const product = await createProduct();
      const onlyOption = await put(product.id, {
        media: [{ url: "https://cdn.example.test/a.png", optionId: colorOptionId }],
      });
      expect(onlyOption.status).toBe(400);
      expect(problem(onlyOption).errors).toEqual([
        expect.objectContaining({ path: "media.0.optionValueId", code: "option_pair_incomplete" }),
      ]);
      const onlyValue = await put(product.id, {
        media: [{ url: "https://cdn.example.test/a.png", optionValueId: colorValueIds.red }],
      });
      expect(onlyValue.status).toBe(400);
      expect(problem(onlyValue).errors).toEqual([
        expect.objectContaining({ path: "media.0.optionId", code: "option_pair_incomplete" }),
      ]);
    });

    it("rejects a value the product did not choose, a value of another option and an unknown value", async () => {
      const product = await createProduct();
      await chooseColorRed(product.id);
      const notChosen = await put(product.id, {
        media: [
          {
            url: "https://cdn.example.test/blue.png",
            optionId: colorOptionId,
            optionValueId: colorValueIds.blue,
          },
        ],
      });
      expect(notChosen.status).toBe(400);
      expect(problem(notChosen).errors).toEqual([
        expect.objectContaining({ path: "media.0.optionValueId", code: "invalid_reference" }),
      ]);
      const wrongOption = await put(product.id, {
        media: [
          {
            url: "https://cdn.example.test/m.png",
            optionId: colorOptionId,
            optionValueId: sizeValueId,
          },
        ],
      });
      expect(wrongOption.status).toBe(400);
      const unknown = await put(product.id, {
        media: [
          {
            url: "https://cdn.example.test/x.png",
            optionId: MISSING_ID,
            optionValueId: MISSING_ID,
          },
        ],
      });
      expect(unknown.status).toBe(400);
      expect((await getProduct(product.id)).media).toEqual([]);
    });

    it.each([
      ["javascript:alert(1)"],
      ["ftp://cdn.example.test/a.png"],
      ["data:image/png;base64,AAAA"],
      ["file:///etc/passwd"],
      ["//cdn.example.test/a.png"],
      ["not a url"],
      [""],
      [`https://cdn.example.test/${"a".repeat(2048)}`],
    ])("rejects the url %j with 400", async (url) => {
      const product = await createProduct();
      const result = await put(product.id, { media: [{ url }] });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ path: "media.0.url" })]);
    });

    it("rejects alt texts with an unknown locale or without the default locale", async () => {
      const product = await createProduct();
      const result = await put(product.id, {
        media: [{ url: "https://cdn.example.test/a.png", alt: { fr: "Photo" } }],
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "media.0.alt.fr", code: "locale_not_allowed" }),
          expect.objectContaining({ path: "media.0.alt.uk", code: "default_locale_missing" }),
        ]),
      );
    });

    it("rejects malformed bodies, unknown fields and too many items", async () => {
      const product = await createProduct();
      expect((await put(product.id, {})).status).toBe(400);
      const unknownField = await put(product.id, {
        media: [{ url: "https://cdn.example.test/a.png", extra: 1 }],
      });
      expect(unknownField.status).toBe(400);
      expect(problem(unknownField).errors).toEqual([
        { path: "media.0.extra", code: "unknown_field" },
      ]);
      const many = await put(product.id, {
        media: Array.from({ length: 101 }, () => ({ url: "https://cdn.example.test/a.png" })),
      });
      expect(many.status).toBe(400);
    });

    it("answers 404 for an unknown product and 400 for a malformed id", async () => {
      expect((await put(MISSING_ID, { media: [] })).status).toBe(404);
      expect((await put("not-a-uuid", { media: [] })).status).toBe(400);
    });
  });
});

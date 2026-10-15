import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "../../../common/pagination.js";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import type { AttributeResponse } from "../attributes/attributes.schemas.js";
import type { OptionResponse } from "../options/options.schemas.js";
import type {
  ProductTypeAttributeResponse,
  ProductTypeDetailResponse,
  ProductTypeOptionResponse,
  ProductTypeResponse,
} from "./product-types.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin product types API (real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const productTypeIds: string[] = [];
  const attributeIds: string[] = [];
  const optionIds: string[] = [];
  const productIds: string[] = [];
  let running: RunningApp;
  let counter = 0;

  function uniqueCode(prefix = "type"): string {
    counter += 1;
    return `${prefix}_${runId}_${counter}`;
  }

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  async function createType(body: Record<string, unknown> = {}): Promise<ProductTypeResponse> {
    const result = await http<ProductTypeResponse>(
      running.baseUrl,
      "POST",
      "/admin/product-types",
      {
        body: { code: uniqueCode(), name: { uk: `Тип ${runId}`, en: "Type" }, ...body },
      },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    productTypeIds.push(result.body.id);
    return result.body;
  }

  async function createAttribute(body: Record<string, unknown> = {}): Promise<AttributeResponse> {
    const result = await http<AttributeResponse>(running.baseUrl, "POST", "/admin/attributes", {
      body: { code: uniqueCode("attr"), name: { uk: "Атрибут" }, inputType: "text", ...body },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    attributeIds.push(result.body.id);
    return result.body;
  }

  async function createOption(): Promise<OptionResponse> {
    const result = await http<OptionResponse>(running.baseUrl, "POST", "/admin/options", {
      body: { code: uniqueCode("opt"), name: { uk: "Опція" } },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    optionIds.push(result.body.id);
    return result.body;
  }

  async function assignAttribute(
    typeId: string,
    attributeId: string,
    body: Record<string, unknown> = { level: "product" },
  ): Promise<ProductTypeAttributeResponse> {
    const result = await http<ProductTypeAttributeResponse>(
      running.baseUrl,
      "PUT",
      `/admin/product-types/${typeId}/attributes/${attributeId}`,
      { body },
    );
    expect([200, 201], JSON.stringify(result.body)).toContain(result.status);
    return result.body;
  }

  /** A product of the type; `attributes` are its stored values, `variantAttributes` those of a default variant. */
  async function seedProduct(
    typeId: string,
    attributes: Record<string, unknown> = {},
    variantAttributes?: Record<string, unknown>,
  ): Promise<string> {
    const product = await pool.query<{ id: string }>(
      "insert into product (product_type_id, slug, title, attributes) values ($1, $2, $3::jsonb, $4::jsonb) returning id",
      [
        typeId,
        uniqueCode("p").replace(/_/g, "-"),
        JSON.stringify({ uk: "Товар" }),
        JSON.stringify(attributes),
      ],
    );
    const id = product.rows[0]?.id ?? "";
    productIds.push(id);
    if (variantAttributes !== undefined) {
      await pool.query(
        "insert into variant (product_id, sku, option_signature, is_default, attributes) values ($1, $2, '', true, $3::jsonb)",
        [id, `V${runId}${counter}`.toUpperCase(), JSON.stringify(variantAttributes)],
      );
    }
    return id;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
  });

  afterAll(async () => {
    await running.app.close();
    if (productIds.length > 0) {
      await pool.query("delete from product where id = any($1::uuid[])", [productIds]);
    }
    await pool.query("delete from product_type where id = any($1::uuid[])", [productTypeIds]);
    await pool.query("delete from attribute where id = any($1::uuid[])", [attributeIds]);
    await pool.query('delete from "option" where id = any($1::uuid[])', [optionIds]);
    await pool.end();
  });

  describe("POST /admin/product-types", () => {
    it("creates a type that requires shipping by default and sets Location", async () => {
      const code = uniqueCode();
      const result = await http<ProductTypeResponse>(
        running.baseUrl,
        "POST",
        "/admin/product-types",
        { body: { code, name: { uk: "Одяг", en: "Clothing" } } },
      );
      productTypeIds.push(result.body.id);
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(`/admin/product-types/${result.body.id}`);
      expect(result.body).toEqual({
        id: expect.stringMatching(UUID),
        code,
        name: { uk: "Одяг", en: "Clothing" },
        requiresShipping: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("stores requiresShipping false (digital goods)", async () => {
      expect((await createType({ requiresShipping: false })).requiresShipping).toBe(false);
    });

    it("answers 409 conflict (field code) for a code that is taken", async () => {
      const existing = await createType();
      const result = await http(running.baseUrl, "POST", "/admin/product-types", {
        body: { code: existing.code, name: { uk: "Ще раз" } },
      });
      expect(result.status).toBe(409);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({
        code: "conflict",
        field: "code",
        constraint: "product_type_code_key",
      });
    });

    it("answers 400 required for a missing code and name", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/product-types", { body: {} });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "code", code: "required" }),
          expect.objectContaining({ path: "name", code: "required" }),
        ]),
      );
    });

    it.each(["Clothing", "1type", "my-type", "", "a".repeat(65)])(
      "answers 400 for the code %j",
      async (code) => {
        const result = await http(running.baseUrl, "POST", "/admin/product-types", {
          body: { code, name: { uk: "x" } },
        });
        expect(result.status).toBe(400);
        expect(problem(result).errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "code" })]),
        );
      },
    );

    it("answers 400 for i18n problems, unknown fields and a non-boolean flag", async () => {
      const i18n = await http(running.baseUrl, "POST", "/admin/product-types", {
        body: { code: uniqueCode(), name: { en: "Only English", de: "Nein" } },
      });
      expect(problem(i18n).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
          expect.objectContaining({ path: "name.de", code: "locale_not_allowed" }),
        ]),
      );
      const structural = await http(running.baseUrl, "POST", "/admin/product-types", {
        body: { code: uniqueCode(), name: { uk: "x" }, requiresShipping: "yes", attributes: [] },
      });
      expect(problem(structural).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "requiresShipping", code: "invalid_type" }),
          expect.objectContaining({ path: "attributes", code: "unknown_field" }),
        ]),
      );
    });
  });

  describe("GET /admin/product-types", () => {
    it("lists a page ordered by code with the total", async () => {
      const prefix = `list_${runId}`;
      await createType({ code: `${prefix}_b` });
      await createType({ code: `${prefix}_a` });
      const all = await http<Page<ProductTypeResponse>>(
        running.baseUrl,
        "GET",
        "/admin/product-types?limit=100",
      );
      expect(all.status).toBe(200);
      expect(
        all.body.items.map((item) => item.code).filter((code) => code.startsWith(prefix)),
      ).toEqual([`${prefix}_a`, `${prefix}_b`]);
      expect(all.body.total).toBeGreaterThanOrEqual(2);
      const page = await http<Page<ProductTypeResponse>>(
        running.baseUrl,
        "GET",
        "/admin/product-types?limit=1&offset=1",
      );
      expect(page.body.items).toHaveLength(1);
      expect(page.body).toMatchObject({ limit: 1, offset: 1 });
    });

    it.each(["limit=0", "limit=101", "offset=-1", "offset=10001"])(
      "answers 400 for ?%s",
      async (query) => {
        expect((await http(running.baseUrl, "GET", `/admin/product-types?${query}`)).status).toBe(
          400,
        );
      },
    );
  });

  describe("GET /admin/product-types/:id", () => {
    it("returns the type with attribute and option assignments ordered by position, then code", async () => {
      const type = await createType();
      const second = await createAttribute({ code: `b_${runId}_x` });
      const first = await createAttribute({ code: `a_${runId}_x` });
      const last = await createAttribute({ code: `c_${runId}_x` });
      await assignAttribute(type.id, second.id, { level: "product", position: 1 });
      await assignAttribute(type.id, first.id, {
        level: "variant",
        position: 1,
        isRequired: true,
      });
      await assignAttribute(type.id, last.id, { level: "product", position: 0 });
      const optionB = await createOption();
      const optionA = await createOption();
      await http(running.baseUrl, "PUT", `/admin/product-types/${type.id}/options/${optionA.id}`, {
        body: { position: 2 },
      });
      await http(running.baseUrl, "PUT", `/admin/product-types/${type.id}/options/${optionB.id}`, {
        body: { position: 1 },
      });

      const result = await http<ProductTypeDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/product-types/${type.id}`,
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id: type.id, code: type.code });
      expect(result.body.attributes.map((entry) => entry.attributeCode)).toEqual([
        last.code,
        first.code,
        second.code,
      ]);
      expect(result.body.attributes[1]).toEqual({
        productTypeId: type.id,
        attributeId: first.id,
        attributeCode: first.code,
        level: "variant",
        isRequired: true,
        position: 1,
        createdAt: expect.any(String),
      });
      expect(result.body.options).toEqual([
        {
          productTypeId: type.id,
          optionId: optionB.id,
          optionCode: optionB.code,
          position: 1,
          createdAt: expect.any(String),
        },
        expect.objectContaining({ optionId: optionA.id, position: 2 }),
      ]);
    });

    it("returns empty assignment lists for a new type", async () => {
      const type = await createType();
      const result = await http<ProductTypeDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/product-types/${type.id}`,
      );
      expect(result.body).toMatchObject({ attributes: [], options: [] });
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect(
        (await http(running.baseUrl, "GET", `/admin/product-types/${MISSING_ID}`)).status,
      ).toBe(404);
      expect((await http(running.baseUrl, "GET", "/admin/product-types/xyz")).status).toBe(400);
    });
  });

  describe("PATCH /admin/product-types/:id", () => {
    it("changes the name and requiresShipping", async () => {
      const type = await createType();
      const result = await http<ProductTypeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/product-types/${type.id}`,
        { body: { name: { uk: "Нова назва" }, requiresShipping: false } },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: type.id,
        code: type.code,
        name: { uk: "Нова назва" },
        requiresShipping: false,
      });
    });

    it("answers with the unchanged type for an empty body", async () => {
      const type = await createType();
      const result = await http<ProductTypeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/product-types/${type.id}`,
        { body: {} },
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(type);
    });

    it("rejects the code with 400 unknown_field (codes are immutable) and bad names", async () => {
      const type = await createType();
      const code = await http(running.baseUrl, "PATCH", `/admin/product-types/${type.id}`, {
        body: { code: uniqueCode() },
      });
      expect(code.status).toBe(400);
      expect(problem(code).errors).toEqual([
        expect.objectContaining({ path: "code", code: "unknown_field" }),
      ]);
      const name = await http(running.baseUrl, "PATCH", `/admin/product-types/${type.id}`, {
        body: { name: { en: "x" } },
      });
      expect(problem(name).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
      ]);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect(
        (
          await http(running.baseUrl, "PATCH", `/admin/product-types/${MISSING_ID}`, {
            body: { requiresShipping: false },
          })
        ).status,
      ).toBe(404);
      expect(
        (await http(running.baseUrl, "PATCH", "/admin/product-types/xyz", { body: {} })).status,
      ).toBe(400);
    });
  });

  describe("DELETE /admin/product-types/:id", () => {
    it("deletes an unused type together with its assignments", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      const option = await createOption();
      await assignAttribute(type.id, attribute.id);
      await http(running.baseUrl, "PUT", `/admin/product-types/${type.id}/options/${option.id}`, {
        body: {},
      });
      const result = await http(running.baseUrl, "DELETE", `/admin/product-types/${type.id}`);
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      expect((await http(running.baseUrl, "GET", `/admin/product-types/${type.id}`)).status).toBe(
        404,
      );
      const rows = await pool.query(
        "select (select count(*) from product_type_attribute where product_type_id = $1)::int as attrs, (select count(*) from product_type_option where product_type_id = $1)::int as opts",
        [type.id],
      );
      expect(rows.rows[0]).toEqual({ attrs: 0, opts: 0 });
    });

    it("answers 409 rule_violation product_type_in_use while a product has the type", async () => {
      const type = await createType();
      const productId = await seedProduct(type.id);
      const blocked = await http(running.baseUrl, "DELETE", `/admin/product-types/${type.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(blocked)).toMatchObject({
        code: "rule_violation",
        rule: "product_type_in_use",
      });
      await pool.query("delete from product where id = $1", [productId]);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/product-types/${type.id}`)).status,
      ).toBe(204);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/product-types/${MISSING_ID}`)).status,
      ).toBe(404);
      expect((await http(running.baseUrl, "DELETE", "/admin/product-types/xyz")).status).toBe(400);
    });
  });

  describe("PUT /admin/product-types/:id/attributes/:attributeId", () => {
    it("creates an assignment (201, defaults) and replaces it (200)", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      const path = `/admin/product-types/${type.id}/attributes/${attribute.id}`;

      const created = await http<ProductTypeAttributeResponse>(running.baseUrl, "PUT", path, {
        body: { level: "product" },
      });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({
        productTypeId: type.id,
        attributeId: attribute.id,
        attributeCode: attribute.code,
        level: "product",
        isRequired: false,
        position: 0,
        createdAt: expect.any(String),
      });

      const replaced = await http<ProductTypeAttributeResponse>(running.baseUrl, "PUT", path, {
        body: { level: "product", isRequired: true, position: 3 },
      });
      expect(replaced.status).toBe(200);
      expect(replaced.body).toMatchObject({ isRequired: true, position: 3 });
      expect(replaced.body.createdAt).toBe(created.body.createdAt);

      const reset = await http<ProductTypeAttributeResponse>(running.baseUrl, "PUT", path, {
        body: { level: "product" },
      });
      expect(reset.body).toMatchObject({ isRequired: false, position: 0 });
    });

    it("answers 400 for a missing or invalid level, unknown fields and bad numbers", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      const path = `/admin/product-types/${type.id}/attributes/${attribute.id}`;
      const missing = await http(running.baseUrl, "PUT", path, { body: {} });
      expect(missing.status).toBe(400);
      expect(problem(missing).errors).toEqual([expect.objectContaining({ path: "level" })]);
      const invalid = await http(running.baseUrl, "PUT", path, {
        body: { level: "category", isRequired: "yes", position: -1, extra: 1 },
      });
      expect(problem(invalid).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "level", code: "invalid_value" }),
          expect.objectContaining({ path: "isRequired", code: "invalid_type" }),
          expect.objectContaining({ path: "position", code: "too_small" }),
          expect.objectContaining({ path: "extra", code: "unknown_field" }),
        ]),
      );
    });

    it("answers 404 for an unknown type or attribute and 400 for malformed ids", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      const body = { level: "product" };
      expect(
        (
          await http(
            running.baseUrl,
            "PUT",
            `/admin/product-types/${MISSING_ID}/attributes/${attribute.id}`,
            { body },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            running.baseUrl,
            "PUT",
            `/admin/product-types/${type.id}/attributes/${MISSING_ID}`,
            { body },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(running.baseUrl, "PUT", `/admin/product-types/${type.id}/attributes/xyz`, {
            body,
          })
        ).status,
      ).toBe(400);
    });

    it("changes the level while no value exists", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      await assignAttribute(type.id, attribute.id, { level: "product" });
      await seedProduct(type.id, {});
      const result = await http<ProductTypeAttributeResponse>(
        running.baseUrl,
        "PUT",
        `/admin/product-types/${type.id}/attributes/${attribute.id}`,
        { body: { level: "variant" } },
      );
      expect(result.status).toBe(200);
      expect(result.body.level).toBe("variant");
    });

    it("answers 409 rule_violation level_in_use when a product holds a value, but still updates other fields", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      await assignAttribute(type.id, attribute.id, { level: "product" });
      await seedProduct(type.id, { [attribute.code]: { uk: "Бавовна" } });
      const path = `/admin/product-types/${type.id}/attributes/${attribute.id}`;

      const blocked = await http(running.baseUrl, "PUT", path, { body: { level: "variant" } });
      expect(blocked.status).toBe(409);
      expect(problem(blocked)).toMatchObject({ code: "rule_violation", rule: "level_in_use" });

      const sameLevel = await http<ProductTypeAttributeResponse>(running.baseUrl, "PUT", path, {
        body: { level: "product", isRequired: true },
      });
      expect(sameLevel.status).toBe(200);
      expect(sameLevel.body).toMatchObject({ level: "product", isRequired: true });
    });

    it("answers 409 level_in_use when only a variant holds a value", async () => {
      const type = await createType();
      const attribute = await createAttribute({ inputType: "number" });
      await assignAttribute(type.id, attribute.id, { level: "variant" });
      await seedProduct(type.id, {}, { [attribute.code]: 5 });
      const blocked = await http(
        running.baseUrl,
        "PUT",
        `/admin/product-types/${type.id}/attributes/${attribute.id}`,
        { body: { level: "product" } },
      );
      expect(blocked.status).toBe(409);
      expect(problem(blocked).rule).toBe("level_in_use");
    });

    it("looks only at products of this type when deciding about the level", async () => {
      const typeA = await createType();
      const typeB = await createType();
      const attribute = await createAttribute();
      await assignAttribute(typeA.id, attribute.id, { level: "product" });
      await assignAttribute(typeB.id, attribute.id, { level: "product" });
      await seedProduct(typeA.id, { [attribute.code]: { uk: "x" } });
      const result = await http(
        running.baseUrl,
        "PUT",
        `/admin/product-types/${typeB.id}/attributes/${attribute.id}`,
        { body: { level: "variant" } },
      );
      expect(result.status).toBe(200);
    });

    it("refuses the 101st attribute (limit of ADR 0006 section 9)", async () => {
      const type = await createType();
      const created = await pool.query<{ id: string }>(
        `insert into attribute (code, name, input_type, is_localized)
         select 'bulk_${runId}_' || g, '{"uk": "x"}'::jsonb, 'boolean', false from generate_series(1, 100) g
         returning id`,
      );
      attributeIds.push(...created.rows.map((row) => row.id));
      await pool.query(
        `insert into product_type_attribute (product_type_id, attribute_id, level)
         select $1, unnest($2::uuid[]), 'product'`,
        [type.id, created.rows.map((row) => row.id)],
      );
      const extra = await createAttribute();
      const result = await http(
        running.baseUrl,
        "PUT",
        `/admin/product-types/${type.id}/attributes/${extra.id}`,
        { body: { level: "product" } },
      );
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ code: "limit_exceeded" })]);
      // Replacing an existing assignment at the limit is still allowed.
      const first = created.rows[0]?.id ?? "";
      const replace = await http(
        running.baseUrl,
        "PUT",
        `/admin/product-types/${type.id}/attributes/${first}`,
        { body: { level: "product", isRequired: true } },
      );
      expect(replace.status).toBe(200);
    });
  });

  describe("DELETE /admin/product-types/:id/attributes/:attributeId", () => {
    it("removes an assignment that holds no values", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      await assignAttribute(type.id, attribute.id);
      const result = await http(
        running.baseUrl,
        "DELETE",
        `/admin/product-types/${type.id}/attributes/${attribute.id}`,
      );
      expect(result.status).toBe(204);
      const detail = await http<ProductTypeDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/product-types/${type.id}`,
      );
      expect(detail.body.attributes).toEqual([]);
    });

    it("answers 409 rule_violation attribute_assignment_in_use while a product or variant holds a value", async () => {
      const type = await createType();
      const onProduct = await createAttribute();
      const onVariant = await createAttribute({ inputType: "number" });
      await assignAttribute(type.id, onProduct.id, { level: "product" });
      await assignAttribute(type.id, onVariant.id, { level: "variant" });
      const productId = await seedProduct(
        type.id,
        { [onProduct.code]: { uk: "Бавовна" } },
        { [onVariant.code]: 3 },
      );

      for (const attribute of [onProduct, onVariant]) {
        const blocked = await http(
          running.baseUrl,
          "DELETE",
          `/admin/product-types/${type.id}/attributes/${attribute.id}`,
        );
        expect(blocked.status).toBe(409);
        expect(blocked.headers.get("content-type")).toContain("application/problem+json");
        expect(problem(blocked)).toMatchObject({
          code: "rule_violation",
          rule: "attribute_assignment_in_use",
        });
      }

      await pool.query("update product set attributes = '{}'::jsonb where id = $1", [productId]);
      await pool.query("update variant set attributes = '{}'::jsonb where product_id = $1", [
        productId,
      ]);
      for (const attribute of [onProduct, onVariant]) {
        expect(
          (
            await http(
              running.baseUrl,
              "DELETE",
              `/admin/product-types/${type.id}/attributes/${attribute.id}`,
            )
          ).status,
        ).toBe(204);
      }
    });

    it("does not count values of products of another type", async () => {
      const typeA = await createType();
      const typeB = await createType();
      const attribute = await createAttribute();
      await assignAttribute(typeA.id, attribute.id);
      await assignAttribute(typeB.id, attribute.id);
      await seedProduct(typeA.id, { [attribute.code]: { uk: "x" } });
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${typeB.id}/attributes/${attribute.id}`,
          )
        ).status,
      ).toBe(204);
    });

    it("answers 404 when the type, the attribute or the assignment does not exist", async () => {
      const type = await createType();
      const attribute = await createAttribute();
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${type.id}/attributes/${attribute.id}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${MISSING_ID}/attributes/${attribute.id}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${type.id}/attributes/${MISSING_ID}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/product-types/${type.id}/attributes/xyz`))
          .status,
      ).toBe(400);
    });
  });

  describe("PUT /admin/product-types/:id/options/:optionId", () => {
    it("allows an option (201, position 0) and changes its position (200)", async () => {
      const type = await createType();
      const option = await createOption();
      const path = `/admin/product-types/${type.id}/options/${option.id}`;
      const created = await http<ProductTypeOptionResponse>(running.baseUrl, "PUT", path, {
        body: {},
      });
      expect(created.status).toBe(201);
      expect(created.body).toEqual({
        productTypeId: type.id,
        optionId: option.id,
        optionCode: option.code,
        position: 0,
        createdAt: expect.any(String),
      });
      const replaced = await http<ProductTypeOptionResponse>(running.baseUrl, "PUT", path, {
        body: { position: 5 },
      });
      expect(replaced.status).toBe(200);
      expect(replaced.body.position).toBe(5);
    });

    it("answers 400 for a bad position or unknown fields", async () => {
      const type = await createType();
      const option = await createOption();
      const result = await http(
        running.baseUrl,
        "PUT",
        `/admin/product-types/${type.id}/options/${option.id}`,
        { body: { position: -1, level: "product" } },
      );
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "position", code: "too_small" }),
          expect.objectContaining({ path: "level", code: "unknown_field" }),
        ]),
      );
    });

    it("answers 404 for an unknown type or option and 400 for malformed ids", async () => {
      const type = await createType();
      const option = await createOption();
      expect(
        (
          await http(
            running.baseUrl,
            "PUT",
            `/admin/product-types/${MISSING_ID}/options/${option.id}`,
            { body: {} },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            running.baseUrl,
            "PUT",
            `/admin/product-types/${type.id}/options/${MISSING_ID}`,
            { body: {} },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(running.baseUrl, "PUT", `/admin/product-types/${type.id}/options/xyz`, {
            body: {},
          })
        ).status,
      ).toBe(400);
    });
  });

  describe("DELETE /admin/product-types/:id/options/:optionId", () => {
    it("removes an assignment that no product uses", async () => {
      const type = await createType();
      const option = await createOption();
      await http(running.baseUrl, "PUT", `/admin/product-types/${type.id}/options/${option.id}`, {
        body: {},
      });
      const result = await http(
        running.baseUrl,
        "DELETE",
        `/admin/product-types/${type.id}/options/${option.id}`,
      );
      expect(result.status).toBe(204);
      const detail = await http<ProductTypeDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/product-types/${type.id}`,
      );
      expect(detail.body.options).toEqual([]);
    });

    it("answers 409 rule_violation option_in_use_by_products while a product of the type chose it", async () => {
      const type = await createType();
      const other = await createType();
      const option = await createOption();
      for (const id of [type.id, other.id]) {
        await http(running.baseUrl, "PUT", `/admin/product-types/${id}/options/${option.id}`, {
          body: {},
        });
      }
      const productId = await seedProduct(type.id);
      await pool.query("insert into product_option (product_id, option_id) values ($1, $2)", [
        productId,
        option.id,
      ]);

      const blocked = await http(
        running.baseUrl,
        "DELETE",
        `/admin/product-types/${type.id}/options/${option.id}`,
      );
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(blocked)).toMatchObject({
        code: "rule_violation",
        rule: "option_in_use_by_products",
      });

      // The other type has no product using the option, so it may drop it.
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${other.id}/options/${option.id}`,
          )
        ).status,
      ).toBe(204);

      await pool.query("delete from product_option where product_id = $1", [productId]);
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${type.id}/options/${option.id}`,
          )
        ).status,
      ).toBe(204);
    });

    it("answers 404 when the type, the option or the assignment does not exist", async () => {
      const type = await createType();
      const option = await createOption();
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${type.id}/options/${option.id}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/product-types/${MISSING_ID}/options/${option.id}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/product-types/${type.id}/options/xyz`))
          .status,
      ).toBe(400);
    });
  });
});

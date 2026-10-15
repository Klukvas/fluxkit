import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "../../../common/pagination.js";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import type {
  AttributeDetailResponse,
  AttributeOptionResponse,
  AttributeResponse,
} from "./attributes.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin attributes API (real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const attributeIds: string[] = [];
  const productTypeIds: string[] = [];
  const productIds: string[] = [];
  let running: RunningApp;
  let counter = 0;

  function uniqueCode(prefix = "attr"): string {
    counter += 1;
    return `${prefix}_${runId}_${counter}`;
  }

  function name(text = "Attribute"): { uk: string; en: string } {
    return { uk: `${text} ${runId}`, en: `${text} ${runId} en` };
  }

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  async function createAttribute(body: Record<string, unknown> = {}): Promise<AttributeResponse> {
    const result = await http<AttributeResponse>(running.baseUrl, "POST", "/admin/attributes", {
      body: { code: uniqueCode(), name: name(), inputType: "text", ...body },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    attributeIds.push(result.body.id);
    return result.body;
  }

  async function createOption(
    attributeId: string,
    body: Record<string, unknown> = {},
  ): Promise<AttributeOptionResponse> {
    const result = await http<AttributeOptionResponse>(
      running.baseUrl,
      "POST",
      `/admin/attributes/${attributeId}/options`,
      { body: { code: uniqueCode("opt"), label: { uk: "Варіант" }, ...body } },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  /** A product type that assigns the attribute, plus one product (and optionally a variant) holding values. */
  async function seedValues(
    attribute: AttributeResponse,
    values: { product?: unknown; variant?: unknown },
    level: "product" | "variant" = "product",
  ): Promise<{ productTypeId: string; productId: string }> {
    const type = await pool.query<{ id: string }>(
      "insert into product_type (code, name) values ($1, $2::jsonb) returning id",
      [uniqueCode("type"), JSON.stringify({ uk: "Тип" })],
    );
    const productTypeId = type.rows[0]?.id ?? "";
    productTypeIds.push(productTypeId);
    await pool.query(
      "insert into product_type_attribute (product_type_id, attribute_id, level) values ($1, $2, $3)",
      [productTypeId, attribute.id, level],
    );
    const productAttributes =
      values.product === undefined ? {} : { [attribute.code]: values.product };
    const product = await pool.query<{ id: string }>(
      "insert into product (product_type_id, slug, title, attributes) values ($1, $2, $3::jsonb, $4::jsonb) returning id",
      [
        productTypeId,
        uniqueCode("p").replace(/_/g, "-"),
        JSON.stringify({ uk: "Товар" }),
        JSON.stringify(productAttributes),
      ],
    );
    const productId = product.rows[0]?.id ?? "";
    productIds.push(productId);
    if (values.variant !== undefined) {
      await pool.query(
        "insert into variant (product_id, sku, option_signature, is_default, attributes) values ($1, $2, '', true, $3::jsonb)",
        [
          productId,
          `V${runId}${counter}`.toUpperCase(),
          JSON.stringify({ [attribute.code]: values.variant }),
        ],
      );
    }
    return { productTypeId, productId };
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
    if (productTypeIds.length > 0) {
      await pool.query("delete from product_type where id = any($1::uuid[])", [productTypeIds]);
    }
    await pool.query("delete from attribute where id = any($1::uuid[])", [attributeIds]);
    await pool.end();
  });

  describe("POST /admin/attributes", () => {
    it("creates a text attribute with the core defaults and sets Location", async () => {
      const code = uniqueCode();
      const result = await http<AttributeResponse>(running.baseUrl, "POST", "/admin/attributes", {
        body: { code, name: name(), inputType: "text" },
      });
      attributeIds.push(result.body.id);
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(`/admin/attributes/${result.body.id}`);
      expect(result.body).toEqual({
        id: expect.stringMatching(UUID),
        code,
        name: name(),
        description: null,
        inputType: "text",
        isLocalized: true,
        unit: null,
        validation: {},
        isFilterable: false,
        isSearchable: false,
        isVisibleOnStorefront: true,
        isComparable: false,
        isSortable: false,
        isInternal: false,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("stores number attributes with a unit, validation and flags", async () => {
      const attribute = await createAttribute({
        inputType: "number",
        unit: "mm",
        validation: { min: 0, max: 100, integer: true },
        isFilterable: true,
        isSortable: true,
        description: { uk: "Довжина" },
      });
      expect(attribute).toMatchObject({
        inputType: "number",
        isLocalized: false,
        unit: "mm",
        validation: { min: 0, max: 100, integer: true },
        isFilterable: true,
        isSortable: true,
        description: { uk: "Довжина" },
      });
    });

    it("defaults non-text attributes to isLocalized false and stores an empty description as null", async () => {
      const attribute = await createAttribute({ inputType: "boolean", description: {} });
      expect(attribute).toMatchObject({ isLocalized: false, description: null });
    });

    it("hides an internal attribute from the storefront by default", async () => {
      const attribute = await createAttribute({ isInternal: true });
      expect(attribute).toMatchObject({ isInternal: true, isVisibleOnStorefront: false });
    });

    it("answers 409 conflict (field code) for a code that is taken", async () => {
      const existing = await createAttribute();
      const result = await http(running.baseUrl, "POST", "/admin/attributes", {
        body: { code: existing.code, name: name(), inputType: "text" },
      });
      expect(result.status).toBe(409);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({
        status: 409,
        code: "conflict",
        field: "code",
        constraint: "attribute_code_key",
      });
    });

    it("answers 400 for missing code, name and inputType (zod reports a missing enum as invalid_value)", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/attributes", { body: {} });
      expect(result.status).toBe(400);
      expect(problem(result)).toMatchObject({ code: "validation_failed" });
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "code", code: "required" }),
          expect.objectContaining({ path: "name", code: "required" }),
          expect.objectContaining({ path: "inputType", code: "invalid_value" }),
        ]),
      );
    });

    it.each(["Color", "1color", "colo-r", "", "a".repeat(65)])(
      "answers 400 invalid_code for the code %j",
      async (code) => {
        const result = await http(running.baseUrl, "POST", "/admin/attributes", {
          body: { code, name: name(), inputType: "text" },
        });
        expect(result.status).toBe(400);
        expect(problem(result).errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "code" })]),
        );
      },
    );

    it("answers 400 unknown_field and invalid_value for unknown fields and input types", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/attributes", {
        body: { code: uniqueCode(), name: name(), inputType: "color", extra: 1 },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "inputType", code: "invalid_value" }),
          expect.objectContaining({ path: "extra", code: "unknown_field" }),
        ]),
      );
    });

    it("answers 400 for i18n problems of name and description", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/attributes", {
        body: {
          code: uniqueCode(),
          name: { en: "Only English", de: "Nein" },
          description: { uk: "x", xx: "bad" },
          inputType: "text",
        },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
          expect.objectContaining({ path: "name.de", code: "locale_not_allowed" }),
          expect.objectContaining({ path: "description.xx", code: "locale_not_allowed" }),
        ]),
      );
    });

    it.each([
      ["NUL", "m\u0000m"],
      ["a lone surrogate", "m\ud800"],
    ])("answers 400, not 500, for %s in the unit", async (_name, unit) => {
      const result = await http(running.baseUrl, "POST", "/admin/attributes", {
        body: { code: uniqueCode(), name: name(), inputType: "number", unit },
      });
      expect(result.status, JSON.stringify(result.body)).toBe(400);
      expect(result.body).toMatchObject({ errors: [expect.objectContaining({ path: "unit" })] });
    });

    it.each([
      [{ inputType: "text", unit: "mm" }, "unit", "unit_requires_number"],
      [{ inputType: "number", unit: "  " }, "unit", "unit_empty"],
      [{ inputType: "number", unit: "x".repeat(17) }, "unit", "unit_too_long"],
      [{ inputType: "number", isLocalized: true }, "isLocalized", "localized_requires_text"],
      [{ inputType: "text", isSortable: true }, "isSortable", "sortable_requires_number_or_date"],
      [
        { inputType: "text", isFilterable: true },
        "isFilterable",
        "filterable_requires_selectable_type",
      ],
      [
        { inputType: "number", isInternal: true, isFilterable: true },
        "isFilterable",
        "internal_cannot_be_public",
      ],
      [
        { inputType: "text", isInternal: true, isVisibleOnStorefront: true },
        "isVisibleOnStorefront",
        "internal_cannot_be_public",
      ],
    ])("answers 400 from the core definition rules for %j", async (extra, path, code) => {
      const result = await http(running.baseUrl, "POST", "/admin/attributes", {
        body: { code: uniqueCode(), name: name(), ...extra },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ path, code })]),
      );
    });

    it.each([
      [
        { inputType: "text", validation: { min_lenght: 1 } },
        "validation.min_lenght",
        "unknown_key",
      ],
      [
        { inputType: "text", validation: { max_length: "5" } },
        "validation.max_length",
        "invalid_value",
      ],
      [
        { inputType: "number", validation: { min: 5, max: 1 } },
        "validation.min",
        "min_greater_than_max",
      ],
      [{ inputType: "boolean", validation: { min: 1 } }, "validation.min", "unknown_key"],
      [{ inputType: "date", validation: { min: "2025-02-30" } }, "validation.min", "invalid_value"],
    ])("answers 400 from the core validation parser for %j", async (extra, path, code) => {
      const result = await http(running.baseUrl, "POST", "/admin/attributes", {
        body: { code: uniqueCode(), name: name(), ...extra },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ path, code })]);
    });
  });

  describe("GET /admin/attributes", () => {
    it("lists a page ordered by code with the total", async () => {
      const prefix = `list_${runId}`;
      const created = [
        await createAttribute({ code: `${prefix}_b` }),
        await createAttribute({ code: `${prefix}_a` }),
        await createAttribute({ code: `${prefix}_c` }),
      ];
      const all = await http<Page<AttributeResponse>>(
        running.baseUrl,
        "GET",
        "/admin/attributes?limit=100",
      );
      expect(all.status).toBe(200);
      const codes = all.body.items
        .map((item) => item.code)
        .filter((code) => code.startsWith(prefix));
      expect(codes).toEqual([`${prefix}_a`, `${prefix}_b`, `${prefix}_c`]);
      expect(all.body.total).toBeGreaterThanOrEqual(created.length);
      expect(all.body).toMatchObject({ limit: 100, offset: 0 });

      const page = await http<Page<AttributeResponse>>(
        running.baseUrl,
        "GET",
        "/admin/attributes?limit=1&offset=1",
      );
      expect(page.body.items).toHaveLength(1);
      expect(page.body).toMatchObject({ limit: 1, offset: 1 });
    });

    it.each(["limit=0", "limit=101", "limit=x", "offset=-1", "offset=10001"])(
      "answers 400 for ?%s",
      async (query) => {
        const result = await http(running.baseUrl, "GET", `/admin/attributes?${query}`);
        expect(result.status).toBe(400);
        expect(problem(result).code).toBe("validation_failed");
      },
    );
  });

  describe("GET /admin/attributes/:id", () => {
    it("returns the attribute with its options ordered by position, then code", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      await createOption(attribute.id, { code: "zz", position: 1 });
      await createOption(attribute.id, { code: "bb", position: 0 });
      await createOption(attribute.id, { code: "aa", position: 0 });
      const result = await http<AttributeDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/attributes/${attribute.id}`,
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id: attribute.id, code: attribute.code });
      expect(result.body.options.map((option) => option.code)).toEqual(["aa", "bb", "zz"]);
      expect(result.body.options[0]).toEqual({
        id: expect.stringMatching(UUID),
        attributeId: attribute.id,
        code: "aa",
        label: { uk: "Варіант" },
        position: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("returns an empty options list for a text attribute", async () => {
      const attribute = await createAttribute();
      const result = await http<AttributeDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/attributes/${attribute.id}`,
      );
      expect(result.body.options).toEqual([]);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      const missing = await http(running.baseUrl, "GET", `/admin/attributes/${MISSING_ID}`);
      expect(missing.status).toBe(404);
      expect(problem(missing).code).toBe("not_found");
      const malformed = await http(running.baseUrl, "GET", "/admin/attributes/xyz");
      expect(malformed.status).toBe(400);
      expect(problem(malformed).errors).toEqual([
        expect.objectContaining({ path: "id", code: "invalid_format" }),
      ]);
    });
  });

  describe("PATCH /admin/attributes/:id", () => {
    it("changes names, description, validation and flags, and refreshes updatedAt", async () => {
      const attribute = await createAttribute({ inputType: "number" });
      const result = await http<AttributeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}`,
        {
          body: {
            name: { uk: "Нова назва" },
            description: { uk: "Опис" },
            validation: { min: 1 },
            isFilterable: true,
            isComparable: true,
          },
        },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: attribute.id,
        code: attribute.code,
        name: { uk: "Нова назва" },
        description: { uk: "Опис" },
        validation: { min: 1 },
        isFilterable: true,
        isComparable: true,
        inputType: "number",
      });
      expect(Date.parse(result.body.updatedAt)).toBeGreaterThanOrEqual(
        Date.parse(attribute.updatedAt),
      );
    });

    it("clears the description with null and keeps untouched fields", async () => {
      const attribute = await createAttribute({ description: { uk: "Опис" }, isSearchable: true });
      const result = await http<AttributeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}`,
        { body: { description: null } },
      );
      expect(result.body).toMatchObject({ description: null, isSearchable: true });
    });

    it("answers with the unchanged attribute for an empty body", async () => {
      const attribute = await createAttribute();
      const result = await http<AttributeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}`,
        { body: {} },
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(attribute);
    });

    it("hides the attribute when it becomes internal without further flags", async () => {
      const attribute = await createAttribute();
      const result = await http<AttributeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}`,
        { body: { isInternal: true } },
      );
      expect(result.body).toMatchObject({ isInternal: true, isVisibleOnStorefront: false });
    });

    it("answers 400 when a public flag stays on an internal attribute", async () => {
      const attribute = await createAttribute({ inputType: "number", isFilterable: true });
      const result = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { isInternal: true },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "isFilterable", code: "internal_cannot_be_public" }),
      ]);
    });

    it("validates flags against the stored input type", async () => {
      const attribute = await createAttribute();
      const result = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { isSortable: true, validation: { min: 1 } },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "isSortable", code: "sortable_requires_number_or_date" }),
          expect.objectContaining({ path: "validation.min", code: "unknown_key" }),
        ]),
      );
    });

    it("rejects the code with 400 unknown_field (codes are immutable)", async () => {
      const attribute = await createAttribute();
      const result = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { code: uniqueCode() },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "code", code: "unknown_field" }),
      ]);
    });

    it("answers 409 rule_violation input_type_immutable when the input type changes", async () => {
      const attribute = await createAttribute({ inputType: "text" });
      const result = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { inputType: "number" },
      });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({
        code: "rule_violation",
        rule: "input_type_immutable",
      });
      const stored = await http<AttributeResponse>(
        running.baseUrl,
        "GET",
        `/admin/attributes/${attribute.id}`,
      );
      expect(stored.body.inputType).toBe("text");
    });

    it("accepts a PATCH that repeats the stored input type and localization", async () => {
      const attribute = await createAttribute({ inputType: "text" });
      const result = await http<AttributeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}`,
        { body: { inputType: "text", isLocalized: true, name: { uk: "Те саме" } } },
      );
      expect(result.status).toBe(200);
      expect(result.body.name).toEqual({ uk: "Те саме" });
    });

    it("answers 409 rule_violation is_localized_immutable when localization changes", async () => {
      const attribute = await createAttribute({ inputType: "text" });
      const result = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { isLocalized: false },
      });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({
        code: "rule_violation",
        rule: "is_localized_immutable",
      });
    });

    it("changes the unit while no value exists and refuses it once a product holds a value", async () => {
      const attribute = await createAttribute({ inputType: "number", unit: "mm" });
      const free = await http<AttributeResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}`,
        { body: { unit: "cm" } },
      );
      expect(free.status).toBe(200);
      expect(free.body.unit).toBe("cm");

      await seedValues(attribute, { product: 12 });
      const blocked = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { unit: "m" },
      });
      expect(blocked.status).toBe(409);
      expect(problem(blocked)).toMatchObject({ code: "rule_violation", rule: "unit_in_use" });

      const sameUnit = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { unit: "cm", name: { uk: "Та сама одиниця" } },
      });
      expect(sameUnit.status).toBe(200);
    });

    it("also counts values stored on variants for the unit rule", async () => {
      const attribute = await createAttribute({ inputType: "number", unit: "kg" });
      await seedValues(attribute, { variant: 3 }, "variant");
      const blocked = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { unit: null },
      });
      expect(blocked.status).toBe(409);
      expect(problem(blocked)).toMatchObject({ rule: "unit_in_use" });
    });

    it("allows changing validation even when values exist", async () => {
      const attribute = await createAttribute({ inputType: "number" });
      await seedValues(attribute, { product: 5 });
      const result = await http(running.baseUrl, "PATCH", `/admin/attributes/${attribute.id}`, {
        body: { validation: { min: 10 } },
      });
      expect(result.status).toBe(200);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect(
        (
          await http(running.baseUrl, "PATCH", `/admin/attributes/${MISSING_ID}`, {
            body: { name: { uk: "x" } },
          })
        ).status,
      ).toBe(404);
      expect(
        (await http(running.baseUrl, "PATCH", "/admin/attributes/xyz", { body: {} })).status,
      ).toBe(400);
    });
  });

  describe("DELETE /admin/attributes/:id", () => {
    it("deletes an unassigned attribute together with its options", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      const option = await createOption(attribute.id);
      const result = await http(running.baseUrl, "DELETE", `/admin/attributes/${attribute.id}`);
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      expect((await http(running.baseUrl, "GET", `/admin/attributes/${attribute.id}`)).status).toBe(
        404,
      );
      const rows = await pool.query("select 1 from attribute_option where id = $1", [option.id]);
      expect(rows.rowCount).toBe(0);
    });

    it("answers 409 rule_violation attribute_assigned while a product type assigns it", async () => {
      const attribute = await createAttribute();
      const { productTypeId } = await seedValues(attribute, {});
      const blocked = await http(running.baseUrl, "DELETE", `/admin/attributes/${attribute.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(blocked)).toMatchObject({
        code: "rule_violation",
        rule: "attribute_assigned",
      });
      expect((await http(running.baseUrl, "GET", `/admin/attributes/${attribute.id}`)).status).toBe(
        200,
      );

      await pool.query("delete from product_type_attribute where product_type_id = $1", [
        productTypeId,
      ]);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/attributes/${attribute.id}`)).status,
      ).toBe(204);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/attributes/${MISSING_ID}`)).status,
      ).toBe(404);
      expect((await http(running.baseUrl, "DELETE", "/admin/attributes/xyz")).status).toBe(400);
    });
  });

  describe("POST /admin/attributes/:id/options", () => {
    it("creates an option, defaults the position to 0 and sets Location", async () => {
      const attribute = await createAttribute({ inputType: "multiselect" });
      const result = await http<AttributeOptionResponse>(
        running.baseUrl,
        "POST",
        `/admin/attributes/${attribute.id}/options`,
        { body: { code: "42", label: { uk: "Сорок два", en: "Forty two" } } },
      );
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(
        `/admin/attributes/${attribute.id}/options/${result.body.id}`,
      );
      expect(result.body).toMatchObject({
        attributeId: attribute.id,
        code: "42",
        label: { uk: "Сорок два", en: "Forty two" },
        position: 0,
      });
    });

    it("answers 409 conflict for a code the attribute already has", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      await createOption(attribute.id, { code: "dup" });
      const result = await http(
        running.baseUrl,
        "POST",
        `/admin/attributes/${attribute.id}/options`,
        {
          body: { code: "dup", label: { uk: "Ще раз" } },
        },
      );
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({
        code: "conflict",
        constraint: "attribute_option_attribute_id_code_key",
      });
    });

    it("allows the same code on another attribute", async () => {
      const first = await createAttribute({ inputType: "select" });
      const second = await createAttribute({ inputType: "select" });
      await createOption(first.id, { code: "shared" });
      await createOption(second.id, { code: "shared" });
    });

    it.each(["text", "number", "boolean", "date"])(
      "answers 409 rule_violation for a %s attribute",
      async (inputType) => {
        const attribute = await createAttribute({ inputType });
        const result = await http(
          running.baseUrl,
          "POST",
          `/admin/attributes/${attribute.id}/options`,
          { body: { code: "x", label: { uk: "x" } } },
        );
        expect(result.status).toBe(409);
        expect(problem(result)).toMatchObject({
          code: "rule_violation",
          rule: "attribute_options_require_selectable_type",
        });
      },
    );

    it("answers 400 for an invalid code, a missing label and i18n problems", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      const path = `/admin/attributes/${attribute.id}/options`;
      const badCode = await http(running.baseUrl, "POST", path, {
        body: { code: "Red", label: { uk: "x" } },
      });
      expect(problem(badCode).errors).toEqual([
        expect.objectContaining({ path: "code", code: "invalid_code" }),
      ]);
      const noLabel = await http(running.baseUrl, "POST", path, { body: { code: "red" } });
      expect(problem(noLabel).errors).toEqual([
        expect.objectContaining({ path: "label", code: "required" }),
      ]);
      const noDefault = await http(running.baseUrl, "POST", path, {
        body: { code: "red", label: { en: "Red" } },
      });
      expect(problem(noDefault).errors).toEqual([
        expect.objectContaining({ path: "label.uk", code: "default_locale_missing" }),
      ]);
      const unknownField = await http(running.baseUrl, "POST", path, {
        body: { code: "red", label: { uk: "x" }, attributeId: MISSING_ID },
      });
      expect(problem(unknownField).errors).toEqual([
        expect.objectContaining({ path: "attributeId", code: "unknown_field" }),
      ]);
      const badPosition = await http(running.baseUrl, "POST", path, {
        body: { code: "red", label: { uk: "x" }, position: -1 },
      });
      expect(badPosition.status).toBe(400);
    });

    it("answers 404 for an unknown attribute", async () => {
      const result = await http(
        running.baseUrl,
        "POST",
        `/admin/attributes/${MISSING_ID}/options`,
        {
          body: { code: "x", label: { uk: "x" } },
        },
      );
      expect(result.status).toBe(404);
    });

    it("refuses the 501st option (limit of ADR 0006 section 9)", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      await pool.query(
        `insert into attribute_option (attribute_id, code, label)
         select $1, 'o' || g, '{"uk": "x"}'::jsonb from generate_series(1, 500) g`,
        [attribute.id],
      );
      const result = await http(
        running.baseUrl,
        "POST",
        `/admin/attributes/${attribute.id}/options`,
        {
          body: { code: "overflow", label: { uk: "x" } },
        },
      );
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ code: "limit_exceeded" })]);
    });
  });

  describe("PATCH /admin/attributes/:id/options/:optionId", () => {
    it("changes label and position", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      const option = await createOption(attribute.id);
      const result = await http<AttributeOptionResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}/options/${option.id}`,
        { body: { label: { uk: "Нова мітка" }, position: 7 } },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: option.id,
        code: option.code,
        label: { uk: "Нова мітка" },
        position: 7,
      });
    });

    it("rejects the code with 400 unknown_field and invalid labels with 400", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      const option = await createOption(attribute.id);
      const path = `/admin/attributes/${attribute.id}/options/${option.id}`;
      const code = await http(running.baseUrl, "PATCH", path, { body: { code: "renamed" } });
      expect(code.status).toBe(400);
      expect(problem(code).errors).toEqual([
        expect.objectContaining({ path: "code", code: "unknown_field" }),
      ]);
      const label = await http(running.baseUrl, "PATCH", path, { body: { label: { en: "x" } } });
      expect(problem(label).errors).toEqual([
        expect.objectContaining({ path: "label.uk", code: "default_locale_missing" }),
      ]);
    });

    it("answers 404 for an unknown option or an option of another attribute", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      const other = await createAttribute({ inputType: "select" });
      const option = await createOption(attribute.id);
      const missing = await http(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}/options/${MISSING_ID}`,
        { body: { position: 1 } },
      );
      expect(missing.status).toBe(404);
      const foreign = await http(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${other.id}/options/${option.id}`,
        { body: { position: 1 } },
      );
      expect(foreign.status).toBe(404);
      const malformed = await http(
        running.baseUrl,
        "PATCH",
        `/admin/attributes/${attribute.id}/options/xyz`,
        { body: {} },
      );
      expect(malformed.status).toBe(400);
    });
  });

  describe("DELETE /admin/attributes/:id/options/:optionId", () => {
    it("deletes an unused option", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      const option = await createOption(attribute.id);
      const result = await http(
        running.baseUrl,
        "DELETE",
        `/admin/attributes/${attribute.id}/options/${option.id}`,
      );
      expect(result.status).toBe(204);
      const detail = await http<AttributeDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/attributes/${attribute.id}`,
      );
      expect(detail.body.options).toEqual([]);
    });

    it("answers 409 rule_violation attribute_option_in_use while a product's select value uses the code", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      const used = await createOption(attribute.id, { code: "used" });
      const spare = await createOption(attribute.id, { code: "spare" });
      const { productId } = await seedValues(attribute, { product: "used" });
      const path = `/admin/attributes/${attribute.id}/options`;

      const blocked = await http(running.baseUrl, "DELETE", `${path}/${used.id}`);
      expect(blocked.status).toBe(409);
      expect(problem(blocked)).toMatchObject({
        code: "rule_violation",
        rule: "attribute_option_in_use",
      });
      expect((await http(running.baseUrl, "DELETE", `${path}/${spare.id}`)).status).toBe(204);

      await pool.query("update product set attributes = '{}'::jsonb where id = $1", [productId]);
      expect((await http(running.baseUrl, "DELETE", `${path}/${used.id}`)).status).toBe(204);
    });

    it("answers 409 while a multiselect array or a variant value contains the code", async () => {
      const multi = await createAttribute({ inputType: "multiselect" });
      const inArray = await createOption(multi.id, { code: "summer" });
      await seedValues(multi, { product: ["spring", "summer"] });
      const blockedArray = await http(
        running.baseUrl,
        "DELETE",
        `/admin/attributes/${multi.id}/options/${inArray.id}`,
      );
      expect(blockedArray.status).toBe(409);
      expect(problem(blockedArray).rule).toBe("attribute_option_in_use");

      const single = await createAttribute({ inputType: "select" });
      const onVariant = await createOption(single.id, { code: "matte" });
      await seedValues(single, { variant: "matte" }, "variant");
      const blockedVariant = await http(
        running.baseUrl,
        "DELETE",
        `/admin/attributes/${single.id}/options/${onVariant.id}`,
      );
      expect(blockedVariant.status).toBe(409);
      expect(problem(blockedVariant).rule).toBe("attribute_option_in_use");
    });

    it("does not confuse a code with a longer code that merely contains it", async () => {
      const attribute = await createAttribute({ inputType: "multiselect" });
      const short = await createOption(attribute.id, { code: "red" });
      await createOption(attribute.id, { code: "dark_red" });
      await seedValues(attribute, { product: ["dark_red"] });
      const result = await http(
        running.baseUrl,
        "DELETE",
        `/admin/attributes/${attribute.id}/options/${short.id}`,
      );
      expect(result.status).toBe(204);
    });

    it("answers 404 for an unknown option or attribute", async () => {
      const attribute = await createAttribute({ inputType: "select" });
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/attributes/${attribute.id}/options/${MISSING_ID}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await http(
            running.baseUrl,
            "DELETE",
            `/admin/attributes/${MISSING_ID}/options/${MISSING_ID}`,
          )
        ).status,
      ).toBe(404);
    });
  });
});

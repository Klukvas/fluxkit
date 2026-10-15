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
  OptionDetailResponse,
  OptionResponse,
  OptionValueResponse,
} from "./options.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin options API (real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const optionIds: string[] = [];
  const productTypeIds: string[] = [];
  const productIds: string[] = [];
  let running: RunningApp;
  let counter = 0;

  function uniqueCode(prefix = "opt"): string {
    counter += 1;
    return `${prefix}_${runId}_${counter}`;
  }

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  async function createOption(body: Record<string, unknown> = {}): Promise<OptionResponse> {
    const result = await http<OptionResponse>(running.baseUrl, "POST", "/admin/options", {
      body: { code: uniqueCode(), name: { uk: `Опція ${runId}`, en: "Option" }, ...body },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    optionIds.push(result.body.id);
    return result.body;
  }

  async function createValue(
    optionId: string,
    body: Record<string, unknown> = {},
  ): Promise<OptionValueResponse> {
    const result = await http<OptionValueResponse>(
      running.baseUrl,
      "POST",
      `/admin/options/${optionId}/values`,
      { body: { code: uniqueCode("val"), label: { uk: "Значення" }, ...body } },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    return result.body;
  }

  async function insertProductType(): Promise<string> {
    const type = await pool.query<{ id: string }>(
      "insert into product_type (code, name) values ($1, $2::jsonb) returning id",
      [uniqueCode("type"), JSON.stringify({ uk: "Тип" })],
    );
    const id = type.rows[0]?.id ?? "";
    productTypeIds.push(id);
    return id;
  }

  /** A product that chose the option (and optionally one of its values). */
  async function seedProductUsing(optionId: string, valueId?: string): Promise<void> {
    const productTypeId = await insertProductType();
    const product = await pool.query<{ id: string }>(
      "insert into product (product_type_id, slug, title) values ($1, $2, $3::jsonb) returning id",
      [productTypeId, uniqueCode("p").replace(/_/g, "-"), JSON.stringify({ uk: "Товар" })],
    );
    const productId = product.rows[0]?.id ?? "";
    productIds.push(productId);
    await pool.query("insert into product_option (product_id, option_id) values ($1, $2)", [
      productId,
      optionId,
    ]);
    if (valueId !== undefined) {
      await pool.query(
        "insert into product_option_value (product_id, option_id, option_value_id) values ($1, $2, $3)",
        [productId, optionId, valueId],
      );
    }
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
    await pool.query("delete from option where id = any($1::uuid[])", [optionIds]);
    await pool.end();
  });

  describe("POST /admin/options", () => {
    it("creates an option and sets Location", async () => {
      const code = uniqueCode();
      const result = await http<OptionResponse>(running.baseUrl, "POST", "/admin/options", {
        body: { code, name: { uk: "Колір", en: "Color" } },
      });
      optionIds.push(result.body.id);
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(`/admin/options/${result.body.id}`);
      expect(result.body).toEqual({
        id: expect.stringMatching(UUID),
        code,
        name: { uk: "Колір", en: "Color" },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("answers 409 conflict (field code) for a code that is taken", async () => {
      const existing = await createOption();
      const result = await http(running.baseUrl, "POST", "/admin/options", {
        body: { code: existing.code, name: { uk: "Ще раз" } },
      });
      expect(result.status).toBe(409);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({
        code: "conflict",
        field: "code",
        constraint: "option_code_key",
      });
    });

    it("answers 400 required for a missing code and name", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/options", { body: {} });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "code", code: "required" }),
          expect.objectContaining({ path: "name", code: "required" }),
        ]),
      );
    });

    it.each(["Color", "1color", "colo-r", "", "a".repeat(65)])(
      "answers 400 for the code %j",
      async (code) => {
        const result = await http(running.baseUrl, "POST", "/admin/options", {
          body: { code, name: { uk: "x" } },
        });
        expect(result.status).toBe(400);
        expect(problem(result).errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "code" })]),
        );
      },
    );

    it("answers 400 for i18n problems of the name", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/options", {
        body: { code: uniqueCode(), name: { en: "Only English", de: "Nein" } },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
          expect.objectContaining({ path: "name.de", code: "locale_not_allowed" }),
        ]),
      );
    });

    it("answers 400 unknown_field for fields the API does not have", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/options", {
        body: { code: uniqueCode(), name: { uk: "x" }, values: [] },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "values", code: "unknown_field" }),
      ]);
    });
  });

  describe("GET /admin/options", () => {
    it("lists a page ordered by code with the total", async () => {
      const prefix = `list_${runId}`;
      await createOption({ code: `${prefix}_b` });
      await createOption({ code: `${prefix}_a` });
      const all = await http<Page<OptionResponse>>(
        running.baseUrl,
        "GET",
        "/admin/options?limit=100",
      );
      expect(all.status).toBe(200);
      expect(
        all.body.items.map((item) => item.code).filter((code) => code.startsWith(prefix)),
      ).toEqual([`${prefix}_a`, `${prefix}_b`]);
      expect(all.body.total).toBeGreaterThanOrEqual(2);
      const page = await http<Page<OptionResponse>>(
        running.baseUrl,
        "GET",
        "/admin/options?limit=1&offset=1",
      );
      expect(page.body.items).toHaveLength(1);
      expect(page.body).toMatchObject({ limit: 1, offset: 1 });
    });

    it.each(["limit=0", "limit=101", "offset=-1", "offset=10001"])(
      "answers 400 for ?%s",
      async (query) => {
        expect((await http(running.baseUrl, "GET", `/admin/options?${query}`)).status).toBe(400);
      },
    );
  });

  describe("GET /admin/options/:id", () => {
    it("returns the option with its values ordered by position, then code", async () => {
      const option = await createOption();
      await createValue(option.id, { code: "zz", position: 1 });
      await createValue(option.id, { code: "bb", position: 0 });
      await createValue(option.id, { code: "aa", position: 0 });
      const result = await http<OptionDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/options/${option.id}`,
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id: option.id, code: option.code });
      expect(result.body.values.map((value) => value.code)).toEqual(["aa", "bb", "zz"]);
      expect(result.body.values[0]).toEqual({
        id: expect.stringMatching(UUID),
        optionId: option.id,
        code: "aa",
        label: { uk: "Значення" },
        position: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect((await http(running.baseUrl, "GET", `/admin/options/${MISSING_ID}`)).status).toBe(404);
      expect((await http(running.baseUrl, "GET", "/admin/options/xyz")).status).toBe(400);
    });
  });

  describe("PATCH /admin/options/:id", () => {
    it("changes the name", async () => {
      const option = await createOption();
      const result = await http<OptionResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/options/${option.id}`,
        { body: { name: { uk: "Нова назва" } } },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: option.id,
        code: option.code,
        name: { uk: "Нова назва" },
      });
    });

    it("answers with the unchanged option for an empty body", async () => {
      const option = await createOption();
      const result = await http<OptionResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/options/${option.id}`,
        { body: {} },
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(option);
    });

    it("rejects the code with 400 unknown_field (codes are immutable) and bad names", async () => {
      const option = await createOption();
      const code = await http(running.baseUrl, "PATCH", `/admin/options/${option.id}`, {
        body: { code: uniqueCode() },
      });
      expect(code.status).toBe(400);
      expect(problem(code).errors).toEqual([
        expect.objectContaining({ path: "code", code: "unknown_field" }),
      ]);
      const name = await http(running.baseUrl, "PATCH", `/admin/options/${option.id}`, {
        body: { name: { en: "x" } },
      });
      expect(problem(name).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
      ]);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect(
        (
          await http(running.baseUrl, "PATCH", `/admin/options/${MISSING_ID}`, {
            body: { name: { uk: "x" } },
          })
        ).status,
      ).toBe(404);
      expect(
        (await http(running.baseUrl, "PATCH", "/admin/options/xyz", { body: {} })).status,
      ).toBe(400);
    });
  });

  describe("DELETE /admin/options/:id", () => {
    it("deletes an unused option together with its values", async () => {
      const option = await createOption();
      const value = await createValue(option.id);
      const result = await http(running.baseUrl, "DELETE", `/admin/options/${option.id}`);
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      expect((await http(running.baseUrl, "GET", `/admin/options/${option.id}`)).status).toBe(404);
      const rows = await pool.query("select 1 from option_value where id = $1", [value.id]);
      expect(rows.rowCount).toBe(0);
    });

    it("answers 409 rule_violation option_assigned_to_product_type while a product type allows it", async () => {
      const option = await createOption();
      const productTypeId = await insertProductType();
      await pool.query(
        "insert into product_type_option (product_type_id, option_id) values ($1, $2)",
        [productTypeId, option.id],
      );
      const blocked = await http(running.baseUrl, "DELETE", `/admin/options/${option.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(blocked)).toMatchObject({
        code: "rule_violation",
        rule: "option_assigned_to_product_type",
      });
      await pool.query("delete from product_type_option where product_type_id = $1", [
        productTypeId,
      ]);
      expect((await http(running.baseUrl, "DELETE", `/admin/options/${option.id}`)).status).toBe(
        204,
      );
    });

    it("answers 409 rule_violation option_in_use_by_products while a product chose it", async () => {
      const option = await createOption();
      await seedProductUsing(option.id);
      const blocked = await http(running.baseUrl, "DELETE", `/admin/options/${option.id}`);
      expect(blocked.status).toBe(409);
      expect(problem(blocked)).toMatchObject({
        code: "rule_violation",
        rule: "option_in_use_by_products",
      });
      expect((await http(running.baseUrl, "GET", `/admin/options/${option.id}`)).status).toBe(200);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect((await http(running.baseUrl, "DELETE", `/admin/options/${MISSING_ID}`)).status).toBe(
        404,
      );
      expect((await http(running.baseUrl, "DELETE", "/admin/options/xyz")).status).toBe(400);
    });
  });

  describe("POST /admin/options/:id/values", () => {
    it("creates a value, defaults the position to 0 and sets Location", async () => {
      const option = await createOption();
      const result = await http<OptionValueResponse>(
        running.baseUrl,
        "POST",
        `/admin/options/${option.id}/values`,
        { body: { code: "2xl", label: { uk: "2XL", en: "2XL" } } },
      );
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(
        `/admin/options/${option.id}/values/${result.body.id}`,
      );
      expect(result.body).toMatchObject({
        optionId: option.id,
        code: "2xl",
        label: { uk: "2XL", en: "2XL" },
        position: 0,
      });
    });

    it("answers 409 conflict for a code the option already has, and allows it on another option", async () => {
      const option = await createOption();
      await createValue(option.id, { code: "dup" });
      const result = await http(running.baseUrl, "POST", `/admin/options/${option.id}/values`, {
        body: { code: "dup", label: { uk: "Ще раз" } },
      });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({
        code: "conflict",
        constraint: "option_value_option_id_code_key",
      });
      const other = await createOption();
      await createValue(other.id, { code: "dup" });
    });

    it("answers 400 for an invalid code, a missing label and unknown fields", async () => {
      const option = await createOption();
      const path = `/admin/options/${option.id}/values`;
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
      const unknown = await http(running.baseUrl, "POST", path, {
        body: { code: "red", label: { uk: "x" }, optionId: MISSING_ID },
      });
      expect(problem(unknown).errors).toEqual([
        expect.objectContaining({ path: "optionId", code: "unknown_field" }),
      ]);
      const badPosition = await http(running.baseUrl, "POST", path, {
        body: { code: "red", label: { uk: "x" }, position: 1.5 },
      });
      expect(badPosition.status).toBe(400);
    });

    it("answers 404 for an unknown option", async () => {
      const result = await http(running.baseUrl, "POST", `/admin/options/${MISSING_ID}/values`, {
        body: { code: "x", label: { uk: "x" } },
      });
      expect(result.status).toBe(404);
    });

    it("refuses the 501st value (limit of ADR 0006 section 9)", async () => {
      const option = await createOption();
      await pool.query(
        `insert into option_value (option_id, code, label)
         select $1, 'v' || g, '{"uk": "x"}'::jsonb from generate_series(1, 500) g`,
        [option.id],
      );
      const result = await http(running.baseUrl, "POST", `/admin/options/${option.id}/values`, {
        body: { code: "overflow", label: { uk: "x" } },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ code: "limit_exceeded" })]);
    });
  });

  describe("PATCH /admin/options/:id/values/:valueId", () => {
    it("changes label and position", async () => {
      const option = await createOption();
      const value = await createValue(option.id);
      const result = await http<OptionValueResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/options/${option.id}/values/${value.id}`,
        { body: { label: { uk: "Нова мітка" }, position: 4 } },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: value.id,
        code: value.code,
        label: { uk: "Нова мітка" },
        position: 4,
      });
    });

    it("rejects the code with 400 unknown_field and invalid labels with 400", async () => {
      const option = await createOption();
      const value = await createValue(option.id);
      const path = `/admin/options/${option.id}/values/${value.id}`;
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

    it("answers 404 for an unknown value or a value of another option", async () => {
      const option = await createOption();
      const other = await createOption();
      const value = await createValue(option.id);
      expect(
        (
          await http(running.baseUrl, "PATCH", `/admin/options/${option.id}/values/${MISSING_ID}`, {
            body: { position: 1 },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await http(running.baseUrl, "PATCH", `/admin/options/${other.id}/values/${value.id}`, {
            body: { position: 1 },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await http(running.baseUrl, "PATCH", `/admin/options/${option.id}/values/xyz`, {
            body: {},
          })
        ).status,
      ).toBe(400);
    });
  });

  describe("DELETE /admin/options/:id/values/:valueId", () => {
    it("deletes an unused value", async () => {
      const option = await createOption();
      const value = await createValue(option.id);
      const result = await http(
        running.baseUrl,
        "DELETE",
        `/admin/options/${option.id}/values/${value.id}`,
      );
      expect(result.status).toBe(204);
      const detail = await http<OptionDetailResponse>(
        running.baseUrl,
        "GET",
        `/admin/options/${option.id}`,
      );
      expect(detail.body.values).toEqual([]);
    });

    it("answers 409 rule_violation option_value_in_use while a product chose the value", async () => {
      const option = await createOption();
      const used = await createValue(option.id);
      const spare = await createValue(option.id);
      await seedProductUsing(option.id, used.id);
      const path = `/admin/options/${option.id}/values`;

      const blocked = await http(running.baseUrl, "DELETE", `${path}/${used.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(blocked)).toMatchObject({
        code: "rule_violation",
        rule: "option_value_in_use",
      });
      expect((await http(running.baseUrl, "DELETE", `${path}/${spare.id}`)).status).toBe(204);
    });

    it("answers 404 for an unknown value, option or foreign value", async () => {
      const option = await createOption();
      const other = await createOption();
      const value = await createValue(option.id);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/options/${option.id}/values/${MISSING_ID}`))
          .status,
      ).toBe(404);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/options/${MISSING_ID}/values/${value.id}`))
          .status,
      ).toBe(404);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/options/${other.id}/values/${value.id}`))
          .status,
      ).toBe(404);
    });
  });
});

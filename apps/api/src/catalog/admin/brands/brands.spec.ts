import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import type { ProblemBody } from "../../../common/problem.filter.js";
import type { Page } from "../../../common/pagination.js";
import type { BrandResponse } from "./brands.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin brands API (real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const createdBrandIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdProductTypeIds: string[] = [];
  let running: RunningApp;
  let counter = 0;

  /** A name that is unique to this run, so specs never collide with data of other specs or runs. */
  function uniqueName(prefix = "Brand"): { uk: string; en: string } {
    counter += 1;
    return { uk: `${prefix} ${runId} ${counter}`, en: `${prefix} ${runId} ${counter} en` };
  }

  async function createBrand(
    body: Record<string, unknown> = { name: uniqueName() },
  ): Promise<BrandResponse> {
    const result = await http<BrandResponse>(running.baseUrl, "POST", "/admin/brands", { body });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    createdBrandIds.push(result.body.id);
    return result.body;
  }

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
  });

  afterAll(async () => {
    await running.app.close();
    if (createdProductIds.length > 0) {
      await pool.query("delete from product where id = any($1::uuid[])", [createdProductIds]);
    }
    if (createdProductTypeIds.length > 0) {
      await pool.query("delete from product_type where id = any($1::uuid[])", [
        createdProductTypeIds,
      ]);
    }
    await pool.query("delete from brand where id = any($1::uuid[])", [createdBrandIds]);
    await pool.end();
  });

  describe("POST /admin/brands", () => {
    it("creates a brand, generates the slug from the default-locale name and sets Location", async () => {
      const name = uniqueName();
      const result = await http<BrandResponse>(running.baseUrl, "POST", "/admin/brands", {
        body: { name },
      });
      createdBrandIds.push(result.body.id);
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(`/admin/brands/${result.body.id}`);
      expect(result.body).toEqual({
        id: expect.stringMatching(UUID),
        slug: `brand-${runId}-${counter}`,
        name,
        description: null,
        logoUrl: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(new Date(result.body.createdAt).toISOString()).toBe(result.body.createdAt);
    });

    it("romanizes a Ukrainian default-locale name", async () => {
      const brand = await createBrand({ name: { uk: `Тестовий бренд ${runId}` } });
      expect(brand.slug).toBe(`testovyi-brend-${runId}`);
    });

    it("stores description and logoUrl, and an explicit slug as given", async () => {
      const brand = await createBrand({
        name: uniqueName(),
        description: { uk: "Опис", en: "Description" },
        logoUrl: "https://cdn.example.com/logo.svg",
        slug: `custom-${runId}`,
      });
      expect(brand).toMatchObject({
        slug: `custom-${runId}`,
        description: { uk: "Опис", en: "Description" },
        logoUrl: "https://cdn.example.com/logo.svg",
      });
    });

    it("stores an empty description map as no description", async () => {
      const brand = await createBrand({ name: uniqueName(), description: {} });
      expect(brand.description).toBeNull();
    });

    it("gives the next free suffix when the generated slug is taken", async () => {
      const name = { uk: `Collision ${runId}` };
      const first = await createBrand({ name });
      const second = await createBrand({ name });
      const third = await createBrand({ name });
      expect([first.slug, second.slug, third.slug]).toEqual([
        `collision-${runId}`,
        `collision-${runId}-2`,
        `collision-${runId}-3`,
      ]);
    });

    it("keeps slugs unique when several brands with the same name are created at once", async () => {
      const name = { uk: `Parallel ${runId}` };
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          http<BrandResponse>(running.baseUrl, "POST", "/admin/brands", { body: { name } }),
        ),
      );
      for (const result of results) {
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        createdBrandIds.push(result.body.id);
      }
      const slugs = results.map((result) => result.body.slug);
      expect(new Set(slugs).size).toBe(4);
      for (const slug of slugs) {
        expect(slug).toMatch(new RegExp(`^parallel-${runId}(-\\d+)?$`));
      }
    });

    it("answers 409 conflict (field slug) for an explicit slug that is taken", async () => {
      const existing = await createBrand({ name: uniqueName(), slug: `taken-${runId}` });
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: uniqueName(), slug: existing.slug },
      });
      expect(result.status).toBe(409);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({
        type: "about:blank",
        status: 409,
        code: "conflict",
        field: "slug",
        constraint: "brand_slug_key",
      });
    });

    it("answers 400 with required when name is missing", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", { body: {} });
      expect(result.status).toBe(400);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({
        status: 400,
        code: "validation_failed",
        errors: [expect.objectContaining({ path: "name", code: "required" })],
      });
    });

    it("answers 400 default_locale_missing when the default locale is absent", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: { en: "Only English" } },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
      ]);
    });

    it("answers 400 locale_not_allowed for an unknown locale key", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: "Бренд", de: "Marke" }, description: { uk: "ok", xx: "bad" } },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "name.de", code: "locale_not_allowed" }),
          expect.objectContaining({ path: "description.xx", code: "locale_not_allowed" }),
        ]),
      );
    });

    it("answers 400 for empty, empty-map and too long names", async () => {
      const empty = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: "   " } },
      });
      expect(problem(empty).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "empty" }),
      ]);

      const emptyMap = await http(running.baseUrl, "POST", "/admin/brands", { body: { name: {} } });
      expect(problem(emptyMap).errors).toEqual([
        expect.objectContaining({ path: "name", code: "required" }),
      ]);

      const tooLong = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: "x".repeat(256) } },
      });
      expect(problem(tooLong).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "too_long" }),
      ]);
    });

    it("answers 400 invalid_type for a non-string text value", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: 5 } },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "invalid_type" }),
      ]);
    });

    it.each([
      ["not a url"],
      ["ftp://example.com/logo.png"],
      ["javascript:alert(1)"],
      ["data:image/png;base64,AAAA"],
      [`https://example.com/${"a".repeat(2048)}`],
      ["https://example.com/a\u0000b"],
    ])("answers 400 for the logoUrl %j", async (logoUrl) => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: uniqueName(), logoUrl },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ path: "logoUrl" })]);
    });

    it.each([
      ["Bad Slug", "invalid_format"],
      ["UPPER", "invalid_format"],
      ["a--b", "invalid_format"],
      ["-lead", "invalid_format"],
      ["", "empty"],
      ["a".repeat(161), "too_long"],
    ])("answers 400 for the slug %j", async (slug, code) => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: uniqueName(), slug },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ path: "slug", code })]);
    });

    it("answers 400 empty_slug when no slug can be generated from the name", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: { uk: "!!!" } },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        expect.objectContaining({ path: "slug", code: "empty_slug" }),
      ]);
    });

    it("reports all independent problems at once", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: { en: "x" }, description: { zz: "y" } },
      });
      expect(
        problem(result)
          .errors?.map((entry) => entry.path)
          .sort(),
      ).toEqual(["description.uk", "description.zz", "name.uk"]);
    });

    it("rejects unknown fields", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", {
        body: { name: uniqueName(), id: MISSING_ID, position: 3 },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        { path: "id", code: "unknown_field" },
        { path: "position", code: "unknown_field" },
      ]);
    });

    it("answers a problem document for malformed JSON", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/brands", { rawBody: '{"name": ' });
      expect(result.status).toBe(400);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({ code: "validation_failed" });
      expect(JSON.stringify(result.body)).not.toMatch(/Unexpected|JSON at position/);
    });
  });

  describe("GET /admin/brands/:id", () => {
    it("returns the brand", async () => {
      const created = await createBrand();
      const result = await http<BrandResponse>(
        running.baseUrl,
        "GET",
        `/admin/brands/${created.id}`,
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(created);
    });

    it("answers 404 not_found for an unknown id", async () => {
      const result = await http(running.baseUrl, "GET", `/admin/brands/${MISSING_ID}`);
      expect(result.status).toBe(404);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({ status: 404, code: "not_found" });
    });

    it("answers 400 for an id that is not a uuid", async () => {
      const result = await http(running.baseUrl, "GET", "/admin/brands/not-a-uuid");
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ path: "id" })]);
    });
  });

  describe("GET /admin/brands", () => {
    it("paginates in a stable slug order and reports the total", async () => {
      const group = `list${runId}`;
      for (const letter of ["c", "a", "b", "d"]) {
        await createBrand({ name: { uk: `${group} ${letter}` } });
      }
      const all = await http<Page<BrandResponse>>(
        running.baseUrl,
        "GET",
        "/admin/brands?limit=100",
      );
      expect(all.status).toBe(200);
      const slugs = all.body.items.map((item) => item.slug);
      expect(slugs).toEqual([...slugs].sort());
      expect(all.body.total).toBeGreaterThanOrEqual(4);
      expect(all.body).toMatchObject({ limit: 100, offset: 0 });

      const pageOne = await http<Page<BrandResponse>>(
        running.baseUrl,
        "GET",
        "/admin/brands?limit=2&offset=0",
      );
      const pageTwo = await http<Page<BrandResponse>>(
        running.baseUrl,
        "GET",
        "/admin/brands?limit=2&offset=2",
      );
      expect(pageOne.body).toMatchObject({ limit: 2, offset: 0, total: all.body.total });
      expect(pageTwo.body).toMatchObject({ limit: 2, offset: 2, total: all.body.total });
      expect(pageOne.body.items).toHaveLength(2);
      expect([...pageOne.body.items, ...pageTwo.body.items].map((item) => item.slug)).toEqual(
        slugs.slice(0, 4),
      );
    });

    it("uses limit 50 and offset 0 by default", async () => {
      const result = await http<Page<BrandResponse>>(running.baseUrl, "GET", "/admin/brands");
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ limit: 50, offset: 0 });
      expect(result.body.items.length).toBeLessThanOrEqual(50);
    });

    it("returns an empty page, with the total, past the end", async () => {
      const result = await http<Page<BrandResponse>>(
        running.baseUrl,
        "GET",
        "/admin/brands?offset=10000",
      );
      expect(result.status).toBe(200);
      expect(result.body.items).toEqual([]);
      expect(result.body.total).toBeGreaterThanOrEqual(0);
    });

    it.each([
      ["limit=0", "limit"],
      ["limit=101", "limit"],
      ["limit=-1", "limit"],
      ["limit=abc", "limit"],
      ["limit=1&limit=2", "limit"],
      ["offset=10001", "offset"],
      ["offset=-1", "offset"],
    ])("answers 400 for ?%s", async (query, path) => {
      const result = await http(running.baseUrl, "GET", `/admin/brands?${query}`);
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ path })]);
    });
  });

  describe("PATCH /admin/brands/:id", () => {
    it("changes only the listed fields and keeps the slug when the name changes", async () => {
      const created = await createBrand({
        name: uniqueName(),
        description: { uk: "Опис" },
        logoUrl: "https://cdn.example.com/a.png",
      });
      const name = { uk: `Renamed ${runId}`, en: "Renamed" };
      const result = await http<BrandResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/brands/${created.id}`,
        {
          body: { name },
        },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: created.id,
        slug: created.slug,
        name,
        description: { uk: "Опис" },
        logoUrl: "https://cdn.example.com/a.png",
        createdAt: created.createdAt,
      });
      expect(Date.parse(result.body.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("replaces a text map as a whole instead of merging", async () => {
      const created = await createBrand({ name: { uk: `Whole ${runId}`, en: "Whole" } });
      const result = await http<BrandResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/brands/${created.id}`,
        {
          body: { name: { uk: `Whole ${runId} only uk` } },
        },
      );
      expect(result.body.name).toEqual({ uk: `Whole ${runId} only uk` });
    });

    it("sets and clears description and logoUrl with null", async () => {
      const created = await createBrand();
      const set = await http<BrandResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/brands/${created.id}`,
        {
          body: { description: { uk: "Новий" }, logoUrl: "http://cdn.example.com/b.png" },
        },
      );
      expect(set.body).toMatchObject({
        description: { uk: "Новий" },
        logoUrl: "http://cdn.example.com/b.png",
      });
      const cleared = await http<BrandResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/brands/${created.id}`,
        {
          body: { description: null, logoUrl: null },
        },
      );
      expect(cleared.body).toMatchObject({ description: null, logoUrl: null });
    });

    it("changes the slug and validates it", async () => {
      const created = await createBrand();
      const ok = await http<BrandResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/brands/${created.id}`,
        {
          body: { slug: `edited-${runId}` },
        },
      );
      expect(ok.body.slug).toBe(`edited-${runId}`);
      const bad = await http(running.baseUrl, "PATCH", `/admin/brands/${created.id}`, {
        body: { slug: "Not Valid" },
      });
      expect(bad.status).toBe(400);
      expect(problem(bad).errors).toEqual([
        expect.objectContaining({ path: "slug", code: "invalid_format" }),
      ]);
    });

    it("answers 409 conflict when the slug belongs to another brand", async () => {
      const other = await createBrand();
      const created = await createBrand();
      const result = await http(running.baseUrl, "PATCH", `/admin/brands/${created.id}`, {
        body: { slug: other.slug },
      });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({ code: "conflict", field: "slug" });
    });

    it("answers 400 for unknown fields, including id and createdAt", async () => {
      const created = await createBrand();
      const result = await http(running.baseUrl, "PATCH", `/admin/brands/${created.id}`, {
        body: { title: "x", id: MISSING_ID, createdAt: "2020-01-01T00:00:00.000Z" },
      });
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([
        { path: "title", code: "unknown_field" },
        { path: "id", code: "unknown_field" },
        { path: "createdAt", code: "unknown_field" },
      ]);
    });

    it("applies the same text rules as create", async () => {
      const created = await createBrand();
      const result = await http(running.baseUrl, "PATCH", `/admin/brands/${created.id}`, {
        body: { name: { en: "no default" }, description: { de: "x" } },
      });
      expect(result.status).toBe(400);
      expect(
        problem(result)
          .errors?.map((entry) => `${entry.path}:${entry.code}`)
          .sort(),
      ).toEqual([
        "description.de:locale_not_allowed",
        "description.uk:default_locale_missing",
        "name.uk:default_locale_missing",
      ]);
    });

    it("rejects null for the required name", async () => {
      const created = await createBrand();
      const result = await http(running.baseUrl, "PATCH", `/admin/brands/${created.id}`, {
        body: { name: null },
      });
      expect(result.status).toBe(400);
    });

    it("treats an empty body as a no-op", async () => {
      const created = await createBrand();
      const result = await http<BrandResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/brands/${created.id}`,
        {
          body: {},
        },
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(created);
    });

    it("answers 404 for an unknown id", async () => {
      const result = await http(running.baseUrl, "PATCH", `/admin/brands/${MISSING_ID}`, {
        body: { logoUrl: null },
      });
      expect(result.status).toBe(404);
      expect(problem(result).code).toBe("not_found");
    });
  });

  describe("DELETE /admin/brands/:id", () => {
    it("deletes an unused brand with 204 and no body", async () => {
      const created = await createBrand();
      const result = await http(running.baseUrl, "DELETE", `/admin/brands/${created.id}`);
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      expect((await http(running.baseUrl, "GET", `/admin/brands/${created.id}`)).status).toBe(404);
      expect((await http(running.baseUrl, "DELETE", `/admin/brands/${created.id}`)).status).toBe(
        404,
      );
    });

    it("answers 409 in_use while a product uses the brand, and deletes it afterwards", async () => {
      const created = await createBrand();
      const typeRow = await pool.query<{ id: string }>(
        "insert into product_type (code, name) values ($1, $2::jsonb) returning id",
        [`t_${runId}`, JSON.stringify({ uk: "Тип" })],
      );
      const productTypeId = typeRow.rows[0]?.id ?? "";
      createdProductTypeIds.push(productTypeId);
      const productRow = await pool.query<{ id: string }>(
        "insert into product (product_type_id, brand_id, slug, title) values ($1, $2, $3, $4::jsonb) returning id",
        [productTypeId, created.id, `p-${runId}`, JSON.stringify({ uk: "Товар" })],
      );
      const productId = productRow.rows[0]?.id ?? "";
      createdProductIds.push(productId);

      const blocked = await http(running.baseUrl, "DELETE", `/admin/brands/${created.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(blocked)).toMatchObject({
        status: 409,
        code: "in_use",
        constraint: "product_brand_id_fkey",
      });
      expect((await http(running.baseUrl, "GET", `/admin/brands/${created.id}`)).status).toBe(200);

      await pool.query("delete from product where id = $1", [productId]);
      expect((await http(running.baseUrl, "DELETE", `/admin/brands/${created.id}`)).status).toBe(
        204,
      );
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      expect((await http(running.baseUrl, "DELETE", `/admin/brands/${MISSING_ID}`)).status).toBe(
        404,
      );
      expect((await http(running.baseUrl, "DELETE", "/admin/brands/xyz")).status).toBe(400);
    });
  });

  it("answers a problem document for an unknown route", async () => {
    const result = await http(running.baseUrl, "GET", "/admin/does-not-exist");
    expect(result.status).toBe(404);
    expect(result.headers.get("content-type")).toContain("application/problem+json");
    expect(problem(result).code).toBe("not_found");
  });
});

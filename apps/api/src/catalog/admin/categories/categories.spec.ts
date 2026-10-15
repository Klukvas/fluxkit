import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import type { ProblemBody } from "../../../common/problem.filter.js";
import type { Page } from "../../../common/pagination.js";
import { CategoriesRepository } from "./categories.repository.js";
import type { CategoryResponse } from "./categories.schemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("admin categories API (real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdProductTypeIds: string[] = [];
  let running: RunningApp;
  let counter = 0;

  /** A name that is unique to this run, so specs never collide with data of other specs or runs. */
  function uniqueName(prefix = "Category"): { uk: string; en: string } {
    counter += 1;
    return { uk: `${prefix} ${runId} ${counter}`, en: `${prefix} ${runId} ${counter} en` };
  }

  async function createCategory(
    body: Record<string, unknown> = { name: uniqueName() },
  ): Promise<CategoryResponse> {
    const result = await http<CategoryResponse>(running.baseUrl, "POST", "/admin/categories", {
      body,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    createdCategoryIds.push(result.body.id);
    return result.body;
  }

  async function move(id: string, body: Record<string, unknown>) {
    return http<CategoryResponse>(running.baseUrl, "POST", `/admin/categories/${id}/move`, {
      body,
    });
  }

  function problem(result: { body: unknown }): ProblemBody {
    return result.body as ProblemBody;
  }

  /** Direct children of `parentId` in API order. */
  async function childrenOf(parentId: string): Promise<CategoryResponse[]> {
    const result = await http<Page<CategoryResponse>>(
      running.baseUrl,
      "GET",
      `/admin/categories?parentId=${parentId}&limit=100`,
    );
    expect(result.status).toBe(200);
    return result.body.items;
  }

  async function chain(depth: number): Promise<CategoryResponse[]> {
    const levels: CategoryResponse[] = [];
    for (let level = 1; level <= depth; level += 1) {
      levels.push(
        await createCategory({ name: uniqueName("Level"), parentId: levels.at(-1)?.id ?? null }),
      );
    }
    return levels;
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
    // Parents are RESTRICT: delete leaves first until nothing of this run is left.
    for (let round = 0; round < 10; round += 1) {
      const deleted = await pool.query(
        `delete from category c where c.id = any($1::uuid[])
           and not exists (select 1 from category child where child.parent_id = c.id)`,
        [createdCategoryIds],
      );
      if (deleted.rowCount === 0) {
        break;
      }
    }
    await pool.end();
  });

  describe("POST /admin/categories", () => {
    it("creates a root category, generates the slug from the default-locale name and sets Location", async () => {
      const name = uniqueName();
      const result = await http<CategoryResponse>(running.baseUrl, "POST", "/admin/categories", {
        body: { name },
      });
      createdCategoryIds.push(result.body.id);
      expect(result.status).toBe(201);
      expect(result.headers.get("location")).toBe(`/admin/categories/${result.body.id}`);
      expect(result.body).toEqual({
        id: expect.stringMatching(UUID),
        parentId: null,
        slug: `category-${runId}-${counter}`,
        name,
        description: null,
        position: expect.any(Number),
        isActive: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("romanizes a Ukrainian name and stores description, isActive and an explicit slug as given", async () => {
      const romanized = await createCategory({ name: { uk: `Чоловічий одяг ${runId}` } });
      expect(romanized.slug).toBe(`cholovichyi-odiah-${runId}`);
      const explicit = await createCategory({
        name: uniqueName(),
        description: { uk: "Опис" },
        slug: `custom-${runId}`,
        isActive: false,
      });
      expect(explicit).toMatchObject({
        slug: `custom-${runId}`,
        description: { uk: "Опис" },
        isActive: false,
      });
    });

    it("stores an empty description map as no description", async () => {
      expect(
        (await createCategory({ name: uniqueName(), description: {} })).description,
      ).toBeNull();
    });

    it("creates a child, appends it last and honours an explicit position", async () => {
      const parent = await createCategory();
      const first = await createCategory({ name: uniqueName(), parentId: parent.id });
      const second = await createCategory({ name: uniqueName(), parentId: parent.id });
      const inserted = await createCategory({
        name: uniqueName(),
        parentId: parent.id,
        position: 0,
      });
      expect([first.position, second.position, inserted.position]).toEqual([0, 1, 0]);
      expect((await childrenOf(parent.id)).map((item) => item.id)).toEqual([
        inserted.id,
        first.id,
        second.id,
      ]);
      expect((await childrenOf(parent.id)).map((item) => item.position)).toEqual([0, 1, 2]);
    });

    it("clamps a position past the end to last", async () => {
      const parent = await createCategory();
      await createCategory({ name: uniqueName(), parentId: parent.id });
      const last = await createCategory({
        name: uniqueName(),
        parentId: parent.id,
        position: 999,
      });
      expect(last.position).toBe(1);
    });

    it("gives the next free suffix when the generated slug is taken", async () => {
      const name = { uk: `Collision ${runId}` };
      const first = await createCategory({ name });
      const second = await createCategory({ name });
      const third = await createCategory({ name });
      expect([first.slug, second.slug, third.slug]).toEqual([
        `collision-${runId}`,
        `collision-${runId}-2`,
        `collision-${runId}-3`,
      ]);
    });

    it("generates distinct slugs of at most 160 characters for the same 200 character name", async () => {
      const name = { uk: `${runId}${"a".repeat(192)}` };
      const slugs: string[] = [];
      for (let round = 0; round < 4; round += 1) {
        slugs.push((await createCategory({ name })).slug);
      }
      const base = `${runId}${"a".repeat(152)}`;
      expect(slugs).toEqual([
        base,
        `${base.slice(0, 158)}-2`,
        `${base.slice(0, 158)}-3`,
        `${base.slice(0, 158)}-4`,
      ]);
    });

    describe("retries of a generated slug", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("answers 409 at once, without a retry, for an explicit slug that is taken", async () => {
        const existing = await createCategory({ name: uniqueName(), slug: `fast-${runId}` });
        const inserts = vi.spyOn(running.app.get(CategoriesRepository), "insert");
        const result = await http(running.baseUrl, "POST", "/admin/categories", {
          body: { name: uniqueName(), slug: existing.slug },
        });
        expect(result.status).toBe(409);
        expect(inserts).toHaveBeenCalledTimes(1);
      });

      it("stops with 409 when a retry would generate the same slug again", async () => {
        const name = { uk: `Repeat ${runId}` };
        await createCategory({ name });
        const inserts = vi.spyOn(running.app.get(CategoriesRepository), "insert");
        // The lookup never sees the taken slug, so every attempt generates the colliding one.
        vi.spyOn(running.app.get(CategoriesRepository), "findSlugsStartingWith").mockResolvedValue(
          new Set(),
        );
        const result = await http(running.baseUrl, "POST", "/admin/categories", { body: { name } });
        expect(result.status).toBe(409);
        expect(inserts).toHaveBeenCalledTimes(2);
      });
    });

    it("keeps slugs unique when several categories with the same name are created at once", async () => {
      const name = { uk: `Parallel ${runId}` };
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          http<CategoryResponse>(running.baseUrl, "POST", "/admin/categories", { body: { name } }),
        ),
      );
      for (const result of results) {
        expect(result.status, JSON.stringify(result.body)).toBe(201);
        createdCategoryIds.push(result.body.id);
      }
      const slugs = results.map((result) => result.body.slug);
      expect(new Set(slugs).size).toBe(4);
      const positions = results.map((result) => result.body.position);
      expect(new Set(positions).size).toBe(4);
    });

    it("answers 409 conflict (field slug) for an explicit slug that is taken", async () => {
      const existing = await createCategory({ name: uniqueName(), slug: `taken-${runId}` });
      const result = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: uniqueName(), slug: existing.slug },
      });
      expect(result.status).toBe(409);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({
        status: 409,
        code: "conflict",
        field: "slug",
        constraint: "category_slug_key",
      });
    });

    it("answers 400 invalid_reference when the parent does not exist", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: uniqueName(), parentId: MISSING_ID },
      });
      expect(result.status).toBe(400);
      expect(problem(result)).toMatchObject({
        code: "validation_failed",
        errors: [expect.objectContaining({ path: "parentId", code: "invalid_reference" })],
      });
    });

    it("answers 400 for a parentId that is not a uuid, a bad position and unknown fields", async () => {
      const badParent = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: uniqueName(), parentId: "nope" },
      });
      expect(badParent.status).toBe(400);
      expect(problem(badParent).errors).toEqual([expect.objectContaining({ path: "parentId" })]);

      const badPosition = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: uniqueName(), position: -1 },
      });
      expect(problem(badPosition).errors).toEqual([expect.objectContaining({ path: "position" })]);

      const unknown = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: uniqueName(), color: "red" },
      });
      expect(unknown.status).toBe(400);
    });

    it("answers 400 for missing, wrong-locale, empty and too long names", async () => {
      const missing = await http(running.baseUrl, "POST", "/admin/categories", { body: {} });
      expect(problem(missing).errors).toEqual([
        expect.objectContaining({ path: "name", code: "required" }),
      ]);
      const noDefault = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: { en: "Only English" } },
      });
      expect(problem(noDefault).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
      ]);
      const badLocale = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: { uk: "Ок", de: "Marke" } },
      });
      expect(problem(badLocale).errors).toEqual([
        expect.objectContaining({ path: "name.de", code: "locale_not_allowed" }),
      ]);
      const empty = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: { uk: "   " } },
      });
      expect(problem(empty).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "empty" }),
      ]);
      const tooLong = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: { uk: "x".repeat(256) } },
      });
      expect(problem(tooLong).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "too_long" }),
      ]);
    });

    it("answers 400 for an invalid slug and 400 empty_slug when none can be generated", async () => {
      const invalid = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: uniqueName(), slug: "Not A Slug" },
      });
      expect(invalid.status).toBe(400);
      expect(problem(invalid).errors).toEqual([expect.objectContaining({ path: "slug" })]);
      const empty = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: { uk: "!!!" } },
      });
      expect(empty.status).toBe(400);
      expect(problem(empty).errors).toEqual([
        expect.objectContaining({ path: "slug", code: "empty_slug" }),
      ]);
    });

    it("answers a problem document for malformed JSON", async () => {
      const result = await http(running.baseUrl, "POST", "/admin/categories", {
        rawBody: "{ not json",
      });
      expect(result.status).toBe(400);
      expect(problem(result)).toMatchObject({ status: 400, code: "validation_failed" });
    });

    it("rejects the sixth level over HTTP (depth limit 5)", async () => {
      const levels = await chain(5);
      expect(levels).toHaveLength(5);
      const result = await http(running.baseUrl, "POST", "/admin/categories", {
        body: { name: uniqueName(), parentId: levels[4]?.id },
      });
      expect(result.status).toBe(409);
      expect(problem(result)).toMatchObject({ code: "rule_violation", rule: "max_depth_exceeded" });
    });
  });

  describe("GET /admin/categories/:id", () => {
    it("returns the category", async () => {
      const created = await createCategory();
      const result = await http<CategoryResponse>(
        running.baseUrl,
        "GET",
        `/admin/categories/${created.id}`,
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(created);
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      const missing = await http(running.baseUrl, "GET", `/admin/categories/${MISSING_ID}`);
      expect(missing.status).toBe(404);
      expect(problem(missing)).toMatchObject({ status: 404, code: "not_found" });
      const malformed = await http(running.baseUrl, "GET", "/admin/categories/not-a-uuid");
      expect(malformed.status).toBe(400);
      expect(problem(malformed).errors).toEqual([expect.objectContaining({ path: "id" })]);
    });
  });

  describe("GET /admin/categories", () => {
    it("lists in position, slug, id order, filters by parent and paginates", async () => {
      const parent = await createCategory();
      // Equal positions are impossible through the API, so the slug tiebreak is checked directly in SQL below.
      const c = await createCategory({ name: { uk: `zz c ${runId}` }, parentId: parent.id });
      const a = await createCategory({ name: { uk: `zz a ${runId}` }, parentId: parent.id });
      const b = await createCategory({ name: { uk: `zz b ${runId}` }, parentId: parent.id });
      expect((await childrenOf(parent.id)).map((item) => item.id)).toEqual([c.id, a.id, b.id]);

      const pageOne = await http<Page<CategoryResponse>>(
        running.baseUrl,
        "GET",
        `/admin/categories?parentId=${parent.id}&limit=2&offset=0`,
      );
      const pageTwo = await http<Page<CategoryResponse>>(
        running.baseUrl,
        "GET",
        `/admin/categories?parentId=${parent.id}&limit=2&offset=2`,
      );
      expect(pageOne.body).toMatchObject({ total: 3, limit: 2, offset: 0 });
      expect(pageTwo.body).toMatchObject({ total: 3, limit: 2, offset: 2 });
      expect([...pageOne.body.items, ...pageTwo.body.items].map((item) => item.id)).toEqual([
        c.id,
        a.id,
        b.id,
      ]);

      await pool.query("update category set position = 0 where parent_id = $1", [parent.id]);
      expect((await childrenOf(parent.id)).map((item) => item.id)).toEqual([a.id, b.id, c.id]);
    });

    it("lists all categories by default and nothing for a parent without children", async () => {
      const leaf = await createCategory();
      const all = await http<Page<CategoryResponse>>(running.baseUrl, "GET", "/admin/categories");
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ limit: 50, offset: 0 });
      expect(all.body.total).toBeGreaterThanOrEqual(1);
      expect(await childrenOf(leaf.id)).toEqual([]);
    });

    it.each([
      ["limit=0", "limit"],
      ["limit=101", "limit"],
      ["offset=10001", "offset"],
      ["parentId=nope", "parentId"],
    ])("answers 400 for ?%s", async (query, path) => {
      const result = await http(running.baseUrl, "GET", `/admin/categories?${query}`);
      expect(result.status).toBe(400);
      expect(problem(result).errors).toEqual([expect.objectContaining({ path })]);
    });
  });

  describe("PATCH /admin/categories/:id", () => {
    it("changes only the listed fields and keeps the slug and the position", async () => {
      const created = await createCategory({
        name: uniqueName(),
        description: { uk: "Опис" },
      });
      const name = { uk: `Renamed ${runId}`, en: "Renamed" };
      const result = await http<CategoryResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/categories/${created.id}`,
        { body: { name, isActive: false } },
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: created.id,
        slug: created.slug,
        parentId: null,
        position: created.position,
        name,
        description: { uk: "Опис" },
        isActive: false,
        createdAt: created.createdAt,
      });
      expect(Date.parse(result.body.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    });

    it("edits the slug, clears the description and answers 409 for a taken slug", async () => {
      const created = await createCategory({ name: uniqueName(), description: { uk: "Опис" } });
      const other = await createCategory();
      const edited = await http<CategoryResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/categories/${created.id}`,
        { body: { slug: `edited-${runId}`, description: null } },
      );
      expect(edited.body).toMatchObject({ slug: `edited-${runId}`, description: null });
      const taken = await http(running.baseUrl, "PATCH", `/admin/categories/${created.id}`, {
        body: { slug: other.slug },
      });
      expect(taken.status).toBe(409);
      expect(problem(taken)).toMatchObject({ code: "conflict", field: "slug" });
    });

    it("treats an empty body as no change", async () => {
      const created = await createCategory();
      const result = await http<CategoryResponse>(
        running.baseUrl,
        "PATCH",
        `/admin/categories/${created.id}`,
        { body: {} },
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(created);
    });

    it("rejects parentId, position and unknown fields (only move changes the tree)", async () => {
      const created = await createCategory();
      for (const body of [{ parentId: null }, { position: 3 }, { color: "red" }]) {
        const result = await http(running.baseUrl, "PATCH", `/admin/categories/${created.id}`, {
          body,
        });
        expect(result.status).toBe(400);
        expect(problem(result).code).toBe("validation_failed");
      }
    });

    it("answers 400 for invalid texts, 404 for an unknown id", async () => {
      const created = await createCategory();
      const invalid = await http(running.baseUrl, "PATCH", `/admin/categories/${created.id}`, {
        body: { name: { en: "no default locale" } },
      });
      expect(problem(invalid).errors).toEqual([
        expect.objectContaining({ path: "name.uk", code: "default_locale_missing" }),
      ]);
      const missing = await http(running.baseUrl, "PATCH", `/admin/categories/${MISSING_ID}`, {
        body: { isActive: false },
      });
      expect(missing.status).toBe(404);
      expect(problem(missing).code).toBe("not_found");
    });
  });

  describe("POST /admin/categories/:id/move", () => {
    it("moves a subtree under another parent, keeping slugs and descendants", async () => {
      const women = await createCategory();
      const men = await createCategory();
      const tshirts = await createCategory({ name: uniqueName(), parentId: men.id });
      const small = await createCategory({ name: uniqueName(), parentId: tshirts.id });
      const result = await move(tshirts.id, { parentId: women.id });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        id: tshirts.id,
        parentId: women.id,
        slug: tshirts.slug,
        position: 0,
      });
      expect((await childrenOf(men.id)).map((item) => item.id)).toEqual([]);
      expect((await childrenOf(tshirts.id)).map((item) => item.id)).toEqual([small.id]);
    });

    it("moves to the root level with parentId null", async () => {
      const parent = await createCategory();
      const child = await createCategory({ name: uniqueName(), parentId: parent.id });
      const result = await move(child.id, { parentId: null });
      expect(result.status).toBe(200);
      expect(result.body.parentId).toBeNull();
    });

    it("reorders siblings inside one parent and keeps positions gap-free", async () => {
      const parent = await createCategory();
      const [a, b, c, d] = [
        await createCategory({ name: uniqueName(), parentId: parent.id }),
        await createCategory({ name: uniqueName(), parentId: parent.id }),
        await createCategory({ name: uniqueName(), parentId: parent.id }),
        await createCategory({ name: uniqueName(), parentId: parent.id }),
      ];
      const ids = async () => (await childrenOf(parent.id)).map((item) => item.id);
      expect(await ids()).toEqual([a?.id, b?.id, c?.id, d?.id]);

      expect((await move(d?.id ?? "", { parentId: parent.id, position: 0 })).status).toBe(200);
      expect(await ids()).toEqual([d?.id, a?.id, b?.id, c?.id]);

      expect((await move(d?.id ?? "", { parentId: parent.id, position: 2 })).status).toBe(200);
      expect(await ids()).toEqual([a?.id, b?.id, d?.id, c?.id]);

      expect((await move(a?.id ?? "", { parentId: parent.id })).status).toBe(200);
      expect(await ids()).toEqual([b?.id, d?.id, c?.id, a?.id]);
      expect((await childrenOf(parent.id)).map((item) => item.position)).toEqual([0, 1, 2, 3]);
    });

    it("inserts among the siblings of the new parent and closes nothing it should not touch", async () => {
      const source = await createCategory();
      const target = await createCategory();
      const keep = await createCategory({ name: uniqueName(), parentId: source.id });
      const t1 = await createCategory({ name: uniqueName(), parentId: target.id });
      const t2 = await createCategory({ name: uniqueName(), parentId: target.id });
      const moving = await createCategory({ name: uniqueName(), parentId: source.id });
      expect((await move(moving.id, { parentId: target.id, position: 1 })).status).toBe(200);
      expect((await childrenOf(target.id)).map((item) => item.id)).toEqual([
        t1.id,
        moving.id,
        t2.id,
      ]);
      expect((await childrenOf(target.id)).map((item) => item.position)).toEqual([0, 1, 2]);
      expect((await childrenOf(source.id)).map((item) => item.id)).toEqual([keep.id]);
    });

    it("reorders root categories (first to last, last to first)", async () => {
      const first = await createCategory({ name: uniqueName(), position: 0 });
      const lastRootSql =
        "select id from category where parent_id is null order by position desc, slug desc, id desc limit 1";
      const firstRootSql =
        "select id from category where parent_id is null order by position asc, slug asc, id asc limit 1";
      expect((await pool.query<{ id: string }>(firstRootSql)).rows[0]?.id).toBe(first.id);
      expect((await move(first.id, { parentId: null, position: 1_000_000 })).status).toBe(200);
      expect((await pool.query<{ id: string }>(lastRootSql)).rows[0]?.id).toBe(first.id);
      expect((await move(first.id, { parentId: null, position: 0 })).status).toBe(200);
      expect((await pool.query<{ id: string }>(firstRootSql)).rows[0]?.id).toBe(first.id);
    });

    it("rejects a move under itself with 409 rule_violation moved_under_itself", async () => {
      const node = await createCategory();
      const result = await move(node.id, { parentId: node.id });
      expect(result.status).toBe(409);
      expect(result.headers.get("content-type")).toContain("application/problem+json");
      expect(problem(result)).toMatchObject({
        code: "rule_violation",
        rule: "moved_under_itself",
      });
    });

    it("rejects a move under a descendant with 409 rule_violation would_create_cycle", async () => {
      const [top, middle, bottom] = await chain(3);
      for (const target of [middle, bottom]) {
        const result = await move(top?.id ?? "", { parentId: target?.id });
        expect(result.status).toBe(409);
        expect(problem(result)).toMatchObject({
          code: "rule_violation",
          rule: "would_create_cycle",
        });
      }
      const unchanged = await http<CategoryResponse>(
        running.baseUrl,
        "GET",
        `/admin/categories/${top?.id}`,
      );
      expect(unchanged.body.parentId).toBeNull();
    });

    it("rejects a move that makes the subtree deeper than 5 levels", async () => {
      const levels = await chain(4);
      const subtreeRoot = await createCategory();
      await createCategory({ name: uniqueName(), parentId: subtreeRoot.id });
      // Parent depth 4 + subtree height 2 = 6.
      const tooDeep = await move(subtreeRoot.id, { parentId: levels[3]?.id });
      expect(tooDeep.status).toBe(409);
      expect(problem(tooDeep)).toMatchObject({
        code: "rule_violation",
        rule: "max_depth_exceeded",
      });
      // Parent depth 3 + height 2 = 5 fits.
      expect((await move(subtreeRoot.id, { parentId: levels[2]?.id })).status).toBe(200);
    });

    it("answers 404 for an unknown category and 400 invalid_reference for an unknown parent", async () => {
      const node = await createCategory();
      const missing = await move(MISSING_ID, { parentId: null });
      expect(missing.status).toBe(404);
      expect(problem(missing).code).toBe("not_found");
      const noParent = await move(node.id, { parentId: MISSING_ID });
      expect(noParent.status).toBe(400);
      expect(problem(noParent).errors).toEqual([
        expect.objectContaining({ path: "parentId", code: "invalid_reference" }),
      ]);
    });

    it("answers 400 for a missing parentId, a malformed body and unknown fields", async () => {
      const node = await createCategory();
      expect((await move(node.id, {})).status).toBe(400);
      expect((await move(node.id, { parentId: "nope" })).status).toBe(400);
      expect((await move(node.id, { parentId: null, position: -1 })).status).toBe(400);
      expect((await move(node.id, { parentId: null, slug: "x" })).status).toBe(400);
      expect((await move("not-a-uuid", { parentId: null })).status).toBe(400);
    });

    it("never lets two simultaneous moves create a cycle (tree advisory lock)", async () => {
      for (let round = 0; round < 8; round += 1) {
        const a = await createCategory();
        const b = await createCategory();
        const [first, second] = await Promise.all([
          move(a.id, { parentId: b.id }),
          move(b.id, { parentId: a.id }),
        ]);
        const statuses = [first.status, second.status].sort();
        expect(statuses, `round ${round}: ${JSON.stringify([first.body, second.body])}`).toEqual([
          200, 409,
        ]);
        const loser = first.status === 409 ? first : second;
        expect(problem(loser)).toMatchObject({
          code: "rule_violation",
          rule: "would_create_cycle",
        });
        const rows = await pool.query<{ id: string; parent_id: string | null }>(
          "select id, parent_id from category where id = any($1::uuid[])",
          [[a.id, b.id]],
        );
        expect(rows.rows.filter((row) => row.parent_id !== null)).toHaveLength(1);
      }
    });

    it("never exceeds the depth limit with simultaneous moves", async () => {
      // Two subtrees of height 2 each want to go under different level-3 parents of the same chain: either
      // is fine alone (3 + 2 = 5), but A under B's child after B moved under the chain would be 6.
      const levels = await chain(3);
      const a = await createCategory();
      await createCategory({ name: uniqueName(), parentId: a.id });
      const b = await createCategory();
      const [first, second] = await Promise.all([
        move(b.id, { parentId: levels[2]?.id }),
        move(a.id, { parentId: b.id }),
      ]);
      // b under level 3 (depth 4), a (height 2) under b = 6 > 5: the second one to run must be refused.
      const successes = [first, second].filter((result) => result.status === 200);
      const depthRefusals = [first, second].filter(
        (result) => result.status === 409 && problem(result).rule === "max_depth_exceeded",
      );
      expect(successes).toHaveLength(1);
      expect(depthRefusals).toHaveLength(1);
    });
  });

  describe("DELETE /admin/categories/:id", () => {
    it("deletes an unused category and answers 404 afterwards", async () => {
      const created = await createCategory();
      const result = await http(running.baseUrl, "DELETE", `/admin/categories/${created.id}`);
      expect(result.status).toBe(204);
      expect(result.body).toBeUndefined();
      expect((await http(running.baseUrl, "GET", `/admin/categories/${created.id}`)).status).toBe(
        404,
      );
    });

    it("answers 404 for an unknown id and 400 for a malformed one", async () => {
      const missing = await http(running.baseUrl, "DELETE", `/admin/categories/${MISSING_ID}`);
      expect(missing.status).toBe(404);
      expect((await http(running.baseUrl, "DELETE", "/admin/categories/nope")).status).toBe(400);
    });

    it("answers 409 in_use while the category has children, and deletes it afterwards", async () => {
      const parent = await createCategory();
      const child = await createCategory({ name: uniqueName(), parentId: parent.id });
      const blocked = await http(running.baseUrl, "DELETE", `/admin/categories/${parent.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain("application/problem+json");
      // The detail comes from the service check; the foreign key backstop would say "still in use".
      expect(problem(blocked)).toMatchObject({
        code: "in_use",
        detail: expect.stringContaining("child categories"),
      });
      expect((await http(running.baseUrl, "GET", `/admin/categories/${parent.id}`)).status).toBe(
        200,
      );

      expect((await http(running.baseUrl, "DELETE", `/admin/categories/${child.id}`)).status).toBe(
        204,
      );
      expect((await http(running.baseUrl, "DELETE", `/admin/categories/${parent.id}`)).status).toBe(
        204,
      );
    });

    it("answers 409 in_use while a product is assigned, and deletes it after the assignment is gone", async () => {
      const created = await createCategory();
      const typeRow = await pool.query<{ id: string }>(
        "insert into product_type (code, name) values ($1, $2::jsonb) returning id",
        [`ct_${runId}`, JSON.stringify({ uk: "Тип" })],
      );
      const productTypeId = typeRow.rows[0]?.id ?? "";
      createdProductTypeIds.push(productTypeId);
      const productRow = await pool.query<{ id: string }>(
        "insert into product (product_type_id, slug, title) values ($1, $2, $3::jsonb) returning id",
        [productTypeId, `cp-${runId}`, JSON.stringify({ uk: "Товар" })],
      );
      const productId = productRow.rows[0]?.id ?? "";
      createdProductIds.push(productId);
      await pool.query(
        "insert into product_category (product_id, category_id, is_primary) values ($1, $2, true)",
        [productId, created.id],
      );

      const blocked = await http(running.baseUrl, "DELETE", `/admin/categories/${created.id}`);
      expect(blocked.status).toBe(409);
      expect(problem(blocked)).toMatchObject({
        code: "in_use",
        detail: expect.stringContaining("Products are assigned"),
      });

      await pool.query("delete from product_category where product_id = $1", [productId]);
      expect(
        (await http(running.baseUrl, "DELETE", `/admin/categories/${created.id}`)).status,
      ).toBe(204);
    });
  });
});

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_PORT, type SearchPort } from "../../../common/search-port.js";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import { meiliUrl } from "../../../test/search-engine.js";
import { ProductTypesRepository } from "./product-types.repository.js";
import type {
  ProductTypeDetailResponse,
  ProductTypeOptionResponse,
} from "./product-types.schemas.js";

const splitConflict = {
  code: "rule_violation",
  rule: "split_option_already_set",
  field: "splitsListing",
};

describe("product type split assignment (real API, Postgres and transactional search port)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let on: RunningApp;
  let off: RunningApp;
  let viewer: RunningApp;
  let typeId: string;
  let otherTypeId: string;
  let optionIds: string[];
  let productIds: string[];

  const path = (optionId: string, id = typeId) => `/admin/product-types/${id}/options/${optionId}`;
  const put = (optionId: string, body: Record<string, unknown>, running = on, id = typeId) =>
    http<ProductTypeOptionResponse>(running.baseUrl, "PUT", path(optionId, id), { body });
  const first = () => optionIds[0] ?? "";
  const second = () => optionIds[1] ?? "";

  beforeAll(async () => {
    await ensureMigrated();
    on = await startApp({
      search: {
        enabled: true,
        meiliUrl: meiliUrl(),
        meiliApiKey: "split-write-spec-key-0123456789",
        indexPrefix: "split_write_",
        engineMaxConcurrency: 8,
        engineMaxQueue: 64,
      },
    });
    off = await startApp();
    viewer = await startApp({ adminPrincipal: { role: "viewer" } });
  });

  beforeEach(async () => {
    const code = randomUUID().replaceAll("-", "");
    const types = await pool.query<{ id: string }>(
      `insert into product_type (code, name) values ($1, '{"uk":"Type"}'), ($2, '{"uk":"Other"}') returning id`,
      [`type_${code}`, `other_${code}`],
    );
    typeId = types.rows[0]?.id ?? "";
    otherTypeId = types.rows[1]?.id ?? "";
    const options = await pool.query<{ id: string }>(
      `insert into option (code, name) values ($1, '{"uk":"Axis"}'), ($2, '{"uk":"Other"}') returning id`,
      [`axis_${code}`, `other_${code}`],
    );
    optionIds = options.rows.map((row) => row.id);
    const products = await pool.query<{ id: string }>(
      `insert into product (product_type_id, slug, title)
       values ($1, $3, '{"uk":"One"}'), ($1, $4, '{"uk":"Two"}'), ($2, $5, '{"uk":"Other"}') returning id`,
      [typeId, otherTypeId, `one-${code}`, `two-${code}`, `other-${code}`],
    );
    productIds = products.rows.map((row) => row.id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.query("delete from search_sync_queue where product_id = any($1::uuid[])", [
      productIds,
    ]);
    await pool.query("delete from product where id = any($1::uuid[])", [productIds]);
    await pool.query("delete from product_type where id = any($1::uuid[])", [
      [typeId, otherTypeId],
    ]);
    await pool.query("delete from option where id = any($1::uuid[])", [optionIds]);
  });

  afterAll(async () => {
    await on.app.close();
    await off.app.close();
    await viewer.app.close();
    await pool.end();
  });

  async function marks(): Promise<{ product_id: string; reason: string; change_seq: string }[]> {
    return (
      await pool.query<{ product_id: string; reason: string; change_seq: string }>(
        "select product_id, reason, change_seq from search_sync_queue where product_id = any($1::uuid[]) order by product_id",
        [productIds],
      )
    ).rows;
  }

  async function clearMarks(): Promise<void> {
    await pool.query("delete from search_sync_queue where product_id = any($1::uuid[])", [
      productIds,
    ]);
  }

  async function expectTypeMarked(): Promise<void> {
    expect((await marks()).map(({ product_id, reason }) => ({ product_id, reason }))).toEqual(
      productIds
        .slice(0, 2)
        .sort()
        .map((product_id) => ({ product_id, reason: "option_changed" })),
    );
  }

  it("defaults false, preserves an omitted flag, marks actual changes only and exposes detail", async () => {
    const created = await put(first(), {});
    expect(created.status).toBe(201);
    expect(created.body.splitsListing).toBe(false);
    expect(await marks()).toEqual([]);
    expect((await put(first(), { splitsListing: true })).body.splitsListing).toBe(true);
    await expectTypeMarked();
    const before = await marks();
    const positionOnly = await put(first(), { position: 7 });
    expect(positionOnly.body).toMatchObject({ splitsListing: true, position: 7 });
    expect(await marks()).toEqual(before);
    await put(first(), { splitsListing: true });
    expect(await marks()).toEqual(before);
    const detail = await http<ProductTypeDetailResponse>(
      on.baseUrl,
      "GET",
      `/admin/product-types/${typeId}`,
    );
    expect(detail.body.options[0]).toMatchObject({ splitsListing: true });
    await clearMarks();
    expect((await put(first(), { splitsListing: false })).body.splitsListing).toBe(false);
    await expectTypeMarked();
  });

  it("marks creation with true and removal of true, but not removal of false", async () => {
    expect((await put(first(), { splitsListing: true })).status).toBe(201);
    await expectTypeMarked();
    await clearMarks();
    expect((await http(on.baseUrl, "DELETE", path(first()))).status).toBe(204);
    await expectTypeMarked();
    await clearMarks();
    await put(second(), {});
    expect((await http(on.baseUrl, "DELETE", path(second()))).status).toBe(204);
    expect(await marks()).toEqual([]);
  });

  it("keeps a true assignment and publishes no mark when products still use it", async () => {
    await put(first(), { splitsListing: true });
    await clearMarks();
    await pool.query("insert into product_option (product_id, option_id) values ($1, $2)", [
      productIds[0],
      first(),
    ]);
    try {
      const result = await http(on.baseUrl, "DELETE", path(first()));
      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({ rule: "option_in_use_by_products" });
      expect(await marks()).toEqual([]);
    } finally {
      await pool.query("delete from product_option where product_id = $1", [productIds[0]]);
    }
  });

  it("refuses a second true assignment without clearing the first and permits another type", async () => {
    await put(first(), { splitsListing: true });
    await put(second(), {});
    await clearMarks();
    const result = await put(second(), { splitsListing: true });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject(splitConflict);
    expect(await marks()).toEqual([]);
    const detail = await http<ProductTypeDetailResponse>(
      on.baseUrl,
      "GET",
      `/admin/product-types/${typeId}`,
    );
    expect(detail.body.options.map((entry) => entry.splitsListing).sort()).toEqual([false, true]);
    expect((await put(first(), { splitsListing: true }, on, otherTypeId)).status).toBe(201);
  });

  it("serializes simultaneous API requests and returns the same 409 for the loser", async () => {
    const results = await Promise.all(
      optionIds.map((optionId) => put(optionId, { splitsListing: true })),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body).toMatchObject(splitConflict);
  });

  it("translates a real unique-index race after the precheck to the same 409", async () => {
    await put(second(), {});
    const repository = on.app.get(ProductTypesRepository);
    const original = repository.listOptionAssignments.bind(repository);
    // A concurrent writer of an existing assignment need not take the service's type-row lock.
    vi.spyOn(repository, "listOptionAssignments").mockImplementationOnce(async (tx, id) => {
      const rows = await original(tx, id);
      await pool.query(
        "update product_type_option set splits_listing = true where product_type_id = $1 and option_id = $2",
        [id, second()],
      );
      return rows;
    });
    const result = await put(first(), { splitsListing: true });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject(splitConflict);
    expect(await marks()).toEqual([]);
    const rows = await pool.query(
      "select option_id from product_type_option where product_type_id = $1 and splits_listing",
      [typeId],
    );
    expect(rows.rows).toEqual([{ option_id: second() }]);
  });

  it("rolls back a mark and the assignment when a failure occurs after the real mark", async () => {
    await put(first(), {});
    const search = on.app.get<SearchPort>(SEARCH_PORT);
    const original = search.productsChangedWhere.bind(search);
    vi.spyOn(search, "productsChangedWhere").mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("Injected failure after the transactional search mark.");
    });
    expect((await put(first(), { splitsListing: true })).status).toBe(500);
    expect(await marks()).toEqual([]);
    const detail = await http<ProductTypeDetailResponse>(
      on.baseUrl,
      "GET",
      `/admin/product-types/${typeId}`,
    );
    expect(detail.body.options[0]?.splitsListing).toBe(false);
  });

  it("search off writes no mark; non-booleans fail validation; permissions stay catalog.write", async () => {
    expect((await put(first(), { splitsListing: true }, off)).status).toBe(201);
    expect(await marks()).toEqual([]);
    const invalid = await put(first(), { splitsListing: "true" });
    expect(invalid.status).toBe(400);
    expect((invalid.body as unknown as ProblemBody).errors).toContainEqual(
      expect.objectContaining({ path: "splitsListing" }),
    );
    expect((await put(first(), { splitsListing: false }, viewer)).status).toBe(403);
    expect((await http(viewer.baseUrl, "GET", `/admin/product-types/${typeId}`)).status).toBe(200);
  });
});

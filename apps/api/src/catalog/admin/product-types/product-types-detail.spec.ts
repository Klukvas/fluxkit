import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PG_POOL } from "../../../database/database.module.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";
import type { AttributeDetailResponse } from "../attributes/attributes.schemas.js";
import type { ProductTypeDetailResponse } from "./product-types.schemas.js";

describe("GET /admin/product-types/:id embeds the attribute definitions (real app, real Postgres)", () => {
  const runId = randomUUID().slice(0, 8);
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const typeIds: string[] = [];
  const attributeIds: string[] = [];
  let running: RunningApp;
  let counter = 0;

  const code = (prefix: string) => `${prefix}_${runId}_${(counter += 1)}`;
  const call = <T = unknown>(method: "GET" | "POST" | "PUT", path: string, body?: unknown) =>
    http<T>(running.baseUrl, method, path, { body });

  async function createType(): Promise<string> {
    const result = await call<{ id: string }>("POST", "/admin/product-types", {
      code: code("type"),
      name: { uk: "Тип", en: "Type" },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    typeIds.push(result.body.id);
    return result.body.id;
  }

  /** A select attribute with `optionCount` options (created in reverse so the order must come from `position`). */
  async function createSelectAttribute(optionCount: number, flags: object = {}): Promise<string> {
    const created = await call<{ id: string }>("POST", "/admin/attributes", {
      code: code("sel"),
      name: { uk: "Вибір", en: "Select" },
      inputType: "select",
      ...flags,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    attributeIds.push(created.body.id);
    for (let index = optionCount; index >= 1; index -= 1) {
      const option = await call("POST", `/admin/attributes/${created.body.id}/options`, {
        code: `o${index}`,
        label: { uk: `Значення ${index}` },
        position: index,
      });
      expect(option.status, JSON.stringify(option.body)).toBe(201);
    }
    return created.body.id;
  }

  async function createTextAttribute(flags: object = {}): Promise<string> {
    const created = await call<{ id: string }>("POST", "/admin/attributes", {
      code: code("txt"),
      name: { uk: "Текст" },
      inputType: "text",
      isLocalized: false,
      ...flags,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    attributeIds.push(created.body.id);
    return created.body.id;
  }

  async function assign(typeId: string, attributeId: string, position: number, level = "product") {
    const result = await call("PUT", `/admin/product-types/${typeId}/attributes/${attributeId}`, {
      level,
      position,
    });
    expect([200, 201], JSON.stringify(result.body)).toContain(result.status);
  }

  async function detail(typeId: string): Promise<ProductTypeDetailResponse> {
    const result = await call<ProductTypeDetailResponse>("GET", `/admin/product-types/${typeId}`);
    expect(result.status).toBe(200);
    return result.body;
  }

  async function statements(typeId: string): Promise<number> {
    const poolOfApp = running.app.get<pg.Pool>(PG_POOL, { strict: false });
    const spy = vi.spyOn(poolOfApp, "query");
    try {
      await detail(typeId);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
  });

  afterAll(async () => {
    await running.app.close();
    await pool.query("delete from product_type where id = any($1::uuid[])", [typeIds]);
    await pool.query("delete from attribute where id = any($1::uuid[])", [attributeIds]);
    await pool.end();
  });

  it("gives every assignment its attribute exactly as GET /admin/attributes/:id shows it, options in order", async () => {
    const typeId = await createType();
    const select = await createSelectAttribute(3, { isFilterable: true });
    const text = await createTextAttribute({ isInternal: true });
    await assign(typeId, select, 0, "variant");
    await assign(typeId, text, 1);

    const body = await detail(typeId);
    expect(body.attributes.map((entry) => entry.attributeId)).toEqual([select, text]);
    for (const entry of body.attributes) {
      const alone = await call<AttributeDetailResponse>(
        "GET",
        `/admin/attributes/${entry.attributeId}`,
      );
      expect(entry.attribute).toEqual(alone.body);
    }
    expect(body.attributes[0]?.attribute.options.map((entry) => entry.code)).toEqual([
      "o1",
      "o2",
      "o3",
    ]);
    expect(body.attributes[1]?.attribute.options).toEqual([]);
  });

  it("keeps every existing field of the assignment", async () => {
    const typeId = await createType();
    const attributeId = await createTextAttribute();
    await assign(typeId, attributeId, 4, "variant");
    const [entry] = (await detail(typeId)).attributes;
    expect(entry).toMatchObject({
      productTypeId: typeId,
      attributeId,
      level: "variant",
      isRequired: false,
      position: 4,
    });
    expect(Object.keys(entry ?? {}).sort()).toEqual(
      [
        "attribute",
        "attributeCode",
        "attributeId",
        "createdAt",
        "isRequired",
        "level",
        "position",
        "productTypeId",
      ].sort(),
    );
  });

  it("shows internal and storefront-hidden attributes to an admin (the store never does)", async () => {
    const typeId = await createType();
    const internal = await createTextAttribute({ isInternal: true });
    await assign(typeId, internal, 0);
    const [entry] = (await detail(typeId)).attributes;
    expect(entry?.attribute).toMatchObject({ id: internal, isInternal: true });
  });

  it("returns empty lists for a type without assignments", async () => {
    const typeId = await createType();
    expect(await detail(typeId)).toMatchObject({ attributes: [], options: [] });
  });

  it("keeps each option list on its own attribute when attributes share nothing", async () => {
    const typeId = await createType();
    const small = await createSelectAttribute(1);
    const large = await createSelectAttribute(4);
    await assign(typeId, small, 0);
    await assign(typeId, large, 1);
    const body = await detail(typeId);
    expect(body.attributes.map((entry) => entry.attribute.options.length)).toEqual([1, 4]);
    for (const entry of body.attributes) {
      for (const option of entry.attribute.options) {
        expect(option.attributeId).toBe(entry.attributeId);
      }
    }
  });

  it("issues the same number of statements for 2 and for 40 assignments, options included", async () => {
    const smallType = await createType();
    await assign(smallType, await createSelectAttribute(2), 0);
    await assign(smallType, await createTextAttribute(), 1);

    const bigType = await createType();
    for (let index = 0; index < 40; index += 1) {
      await assign(
        bigType,
        index % 2 === 0 ? await createSelectAttribute(3) : await createTextAttribute(),
        index,
      );
    }
    const big = await detail(bigType);
    expect(big.attributes).toHaveLength(40);
    expect(big.attributes.filter((entry) => entry.attribute.options.length === 3)).toHaveLength(20);

    const small = await statements(smallType);
    expect(await statements(bigType)).toBe(small);
    expect(small).toBeLessThanOrEqual(5);
  });
});

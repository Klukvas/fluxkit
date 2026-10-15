import { randomUUID } from "node:crypto";
import type pg from "pg";
import { expect } from "vitest";
import { http, type HttpResult } from "./http.js";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Call = <T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
) => Promise<HttpResult<T>>;

export interface OptionFixture {
  id: string;
  code: string;
  /** Value code to value id. */
  values: Record<string, string>;
}

/**
 * Dictionaries for the option and variant specs, created through the real admin API with a unique run id.
 * `tee` allows color, size, finish, extra, biga and bigb (not foreign); `strict` allows color and has a required
 * variant-level attribute.
 */
export interface CatalogFixture {
  runId: string;
  teeTypeId: string;
  strictTypeId: string;
  materialAttributeCode: string;
  supplierAttributeCode: string;
  batchAttributeCode: string;
  color: OptionFixture;
  size: OptionFixture;
  finish: OptionFixture;
  extra: OptionFixture;
  /** 26 values a1..a26. */
  biga: OptionFixture;
  /** 11 values b1..b11. */
  bigb: OptionFixture;
  /** Not allowed by any product type. */
  foreign: OptionFixture;
  cleanup(pool: pg.Pool): Promise<void>;
}

/**
 * The variant invariants of ADR 0006 section 3, checked in the database: at least one variant, exactly one default,
 * unique and correctly computed signatures, and a value for every product option on every variant.
 */
export async function expectVariantInvariants(pool: pg.Pool, productId: string): Promise<void> {
  const counts = await pool.query(
    `select count(*)::int as total,
            count(*) filter (where is_default)::int as defaults,
            count(distinct option_signature)::int as signatures
       from variant where product_id = $1`,
    [productId],
  );
  const { total, defaults, signatures } = counts.rows[0] as {
    total: number;
    defaults: number;
    signatures: number;
  };
  expect(total, "the product has variants").toBeGreaterThan(0);
  expect(defaults, "exactly one default variant").toBe(1);
  expect(signatures, "option signatures are unique").toBe(total);

  const mismatched = await pool.query(
    `select v.id
       from variant v
       left join (
         select vov.variant_id,
                string_agg(o.code || '=' || ov.code, ';' order by o.code collate "C") as signature
           from variant_option_value vov
           join option o on o.id = vov.option_id
           join option_value ov on ov.id = vov.option_value_id
          group by vov.variant_id
       ) s on s.variant_id = v.id
      where v.product_id = $1 and v.option_signature <> coalesce(s.signature, '')`,
    [productId],
  );
  expect(mismatched.rows, "stored signatures match the option values").toEqual([]);

  const uncovered = await pool.query(
    `select v.id from variant v
      where v.product_id = $1
        and (select count(*) from variant_option_value where variant_id = v.id)
            <> (select count(*) from product_option where product_id = v.product_id)`,
    [productId],
  );
  expect(uncovered.rows, "every variant has a value for every product option").toEqual([]);
}

export function newRunId(): string {
  return randomUUID().slice(0, 8);
}

export function caller(baseUrl: () => string): Call {
  return (method, path, body) => http(baseUrl(), method, path, { body }) as never;
}

async function create(call: Call, path: string, body: unknown): Promise<string> {
  const result = await call<{ id: string }>("POST", path, body);
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.id;
}

async function createOption(
  call: Call,
  code: string,
  valueCodes: readonly string[],
): Promise<OptionFixture> {
  const id = await create(call, "/admin/options", { code, name: { uk: code } });
  const values: Record<string, string> = {};
  for (const valueCode of valueCodes) {
    values[valueCode] = await create(call, `/admin/options/${id}/values`, {
      code: valueCode,
      label: { uk: valueCode },
    });
  }
  return { id, code, values };
}

export async function createCatalogFixture(
  call: Call,
  runId = newRunId(),
): Promise<CatalogFixture> {
  const attributeIds: string[] = [];
  const optionIds: string[] = [];
  const typeIds: string[] = [];

  const materialAttributeCode = `mat_${runId}`;
  const supplierAttributeCode = `sup_${runId}`;
  const batchAttributeCode = `batch_${runId}`;
  const material = await create(call, "/admin/attributes", {
    code: materialAttributeCode,
    name: { uk: "Матеріал" },
    inputType: "select",
  });
  for (const code of ["cotton", "linen"]) {
    await create(call, `/admin/attributes/${material}/options`, { code, label: { uk: code } });
  }
  const supplier = await create(call, "/admin/attributes", {
    code: supplierAttributeCode,
    name: { uk: "Постачальник" },
    inputType: "text",
    isLocalized: false,
  });
  const batch = await create(call, "/admin/attributes", {
    code: batchAttributeCode,
    name: { uk: "Партія" },
    inputType: "text",
    isLocalized: false,
  });
  attributeIds.push(material, supplier, batch);

  const color = await createOption(call, `color_${runId}`, ["red", "blue", "green"]);
  const size = await createOption(call, `size_${runId}`, ["s", "m", "l"]);
  const finish = await createOption(call, `finish_${runId}`, ["matte", "gloss"]);
  const extra = await createOption(call, `extra_${runId}`, ["x1", "x2"]);
  const biga = await createOption(
    call,
    `biga_${runId}`,
    Array.from({ length: 26 }, (_, index) => `a${index + 1}`),
  );
  const bigb = await createOption(
    call,
    `bigb_${runId}`,
    Array.from({ length: 11 }, (_, index) => `b${index + 1}`),
  );
  const foreign = await createOption(call, `foreign_${runId}`, ["f1"]);
  optionIds.push(color.id, size.id, finish.id, extra.id, biga.id, bigb.id, foreign.id);

  const tee = await create(call, "/admin/product-types", {
    code: `tee_${runId}`,
    name: { uk: "Футболка" },
  });
  const strict = await create(call, "/admin/product-types", {
    code: `strict_${runId}`,
    name: { uk: "Суворий" },
  });
  typeIds.push(tee, strict);
  const assign = async (typeId: string, attributeId: string, body: unknown) => {
    const result = await call(
      "PUT",
      `/admin/product-types/${typeId}/attributes/${attributeId}`,
      body,
    );
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  };
  await assign(tee, material, { level: "product", isRequired: true });
  await assign(tee, supplier, { level: "variant" });
  await assign(strict, batch, { level: "variant", isRequired: true });
  for (const option of [color, size, finish, extra, biga, bigb]) {
    const result = await call("PUT", `/admin/product-types/${tee}/options/${option.id}`, {});
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
  }
  expect((await call("PUT", `/admin/product-types/${strict}/options/${color.id}`, {})).status).toBe(
    201,
  );

  return {
    runId,
    teeTypeId: tee,
    strictTypeId: strict,
    materialAttributeCode,
    supplierAttributeCode,
    batchAttributeCode,
    color,
    size,
    finish,
    extra,
    biga,
    bigb,
    foreign,
    async cleanup(pool) {
      // Products first (cascade to variants, option rows, media), then what they referenced.
      await pool.query("delete from product where product_type_id = any($1::uuid[])", [typeIds]);
      await pool.query("delete from product_type where id = any($1::uuid[])", [typeIds]);
      await pool.query("delete from attribute where id = any($1::uuid[])", [attributeIds]);
      await pool.query("delete from option where id = any($1::uuid[])", [optionIds]);
    },
  };
}

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";

const PRODUCT_ID = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";
const VARIANT_ID = "7a2d2e3f-9c54-4a5f-8d66-1b2c3d4e5f60";
const PRICES = `/admin/products/${PRODUCT_ID}/variants/${VARIANT_ID}/prices`;

const routes = [
  ["GET", PRICES, undefined],
  ["GET", `/admin/products/not-a-uuid/variants/${VARIANT_ID}/prices`, undefined],
  ["PUT", `${PRICES}/UAH`, { amount: 1 }],
  ["PUT", `${PRICES}/not-a-currency`, { invalid: "not validated before the guard" }],
  ["DELETE", `${PRICES}/UAH`, undefined],
  ["PUT", `/admin/products/${PRODUCT_ID}/prices`, { items: [] }],
  [
    "PUT",
    `/admin/products/${PRODUCT_ID}/prices`,
    { items: [{ variantId: VARIANT_ID, currency: "UAH", amount: 1 }] },
  ],
] as const;

describe("price routes behind the real default guard (no authenticator provided)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default" });
  });

  afterAll(async () => {
    await running.app.close();
    await pool.end();
  });

  it.each(routes)("%s %s answers 401 unauthorized", async (method, path, body) => {
    const result = await http<ProblemBody>(running.baseUrl, method, path, { body });
    expect(result.status).toBe(401);
    expect(result.headers.get("content-type")).toContain("application/problem+json");
    expect(result.body).toMatchObject({ type: "about:blank", status: 401, code: "unauthorized" });
  });

  it("has no side effects: no price was written", async () => {
    const result = await pool.query(
      "select count(*)::int as count from price where variant_id = $1",
      [VARIANT_ID],
    );
    expect(result.rows[0].count).toBe(0);
  });
});

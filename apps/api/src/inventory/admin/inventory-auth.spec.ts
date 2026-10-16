import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";

const PRODUCT_ID = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";
const VARIANT_ID = "7a2d2e3f-9c54-4a5f-8d66-1b2c3d4e5f60";
const INVENTORY = `/admin/products/${PRODUCT_ID}/variants/${VARIANT_ID}/inventory`;

const routes = [
  ["GET", INVENTORY, undefined],
  ["GET", `${INVENTORY}/movements`, undefined],
  ["POST", `${INVENTORY}/adjustments`, { delta: 1, kind: "receipt" }],
  ["POST", `${INVENTORY}/adjustments`, { invalid: "not validated before the guard" }],
  ["GET", `/admin/products/not-a-uuid/variants/${VARIANT_ID}/inventory`, undefined],
  ["GET", "/admin/locations", undefined],
] as const;

describe("inventory routes behind the real default guard (no authenticator provided)", () => {
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

  it("has no side effects: no level and no movement was written", async () => {
    const levels = await pool.query(
      "select count(*)::int as count from inventory_level where variant_id = $1",
      [VARIANT_ID],
    );
    const movements = await pool.query(
      "select count(*)::int as count from stock_movement where variant_id = $1",
      [VARIANT_ID],
    );
    expect(levels.rows[0].count).toBe(0);
    expect(movements.rows[0].count).toBe(0);
  });
});

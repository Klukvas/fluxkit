import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";

const SOME_ID = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";

const routes = [
  ["POST", "/admin/categories", { name: { uk: "Should not be created" }, slug: "auth-spec-nope" }],
  ["POST", "/admin/categories", { invalid: "body is not even validated before the guard" }],
  ["GET", "/admin/categories", undefined],
  ["GET", `/admin/categories?parentId=${SOME_ID}`, undefined],
  ["GET", `/admin/categories/${SOME_ID}`, undefined],
  ["GET", "/admin/categories/not-a-uuid", undefined],
  ["PATCH", `/admin/categories/${SOME_ID}`, { isActive: false }],
  ["DELETE", `/admin/categories/${SOME_ID}`, undefined],
  ["POST", `/admin/categories/${SOME_ID}/move`, { parentId: null }],
] as const;

describe("categories routes behind the real default guard (no authenticator provided)", () => {
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

  it("has no side effects: nothing was created", async () => {
    const result = await pool.query("select count(*)::int as count from category where slug = $1", [
      "auth-spec-nope",
    ]);
    expect(result.rows[0].count).toBe(0);
  });
});

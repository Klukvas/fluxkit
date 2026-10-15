import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";

const SOME_ID = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";
const OTHER_ID = "7a2d2e3f-9c54-4a5f-8d66-1b2c3d4e5f60";

const routes = [
  ["POST", "/admin/attributes", { code: "auth_spec_nope", name: { uk: "Ні" }, inputType: "text" }],
  ["POST", "/admin/attributes", { invalid: "body is not even validated before the guard" }],
  ["GET", "/admin/attributes", undefined],
  ["GET", `/admin/attributes/${SOME_ID}`, undefined],
  ["GET", "/admin/attributes/not-a-uuid", undefined],
  ["PATCH", `/admin/attributes/${SOME_ID}`, { isFilterable: true }],
  ["DELETE", `/admin/attributes/${SOME_ID}`, undefined],
  ["POST", `/admin/attributes/${SOME_ID}/options`, { code: "x", label: { uk: "x" } }],
  ["PATCH", `/admin/attributes/${SOME_ID}/options/${OTHER_ID}`, { position: 1 }],
  ["DELETE", `/admin/attributes/${SOME_ID}/options/${OTHER_ID}`, undefined],
] as const;

describe("attributes routes behind the real default guard (no authenticator provided)", () => {
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

  it("ignores Authorization and API-key headers (there is no interim auth)", async () => {
    const response = await fetch(`${running.baseUrl}/admin/attributes`, {
      headers: { authorization: "Bearer anything", "x-api-key": "anything" },
    });
    expect(response.status).toBe(401);
  });

  it("has no side effects: nothing was created", async () => {
    const result = await pool.query(
      "select count(*)::int as count from attribute where code = $1",
      ["auth_spec_nope"],
    );
    expect(result.rows[0].count).toBe(0);
  });
});

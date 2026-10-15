import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Logger } from "@nestjs/common";
import type { ProblemBody } from "../../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../../test/app.js";
import { requireTestDatabaseUrl } from "../../../test/env.js";
import { http } from "../../../test/http.js";
import { ensureMigrated } from "../../../test/migrate.js";

const SOME_ID = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";

const routes = [
  ["POST", "/admin/brands", { name: { uk: "Should not be created" }, slug: "auth-spec-nope" }],
  ["POST", "/admin/brands", { invalid: "body is not even validated before the guard" }],
  ["GET", "/admin/brands", undefined],
  ["GET", `/admin/brands/${SOME_ID}`, undefined],
  ["GET", "/admin/brands/not-a-uuid", undefined],
  ["PATCH", `/admin/brands/${SOME_ID}`, { logoUrl: null }],
  ["DELETE", `/admin/brands/${SOME_ID}`, undefined],
] as const;

describe("brands routes behind the real default guard (no authenticator provided)", () => {
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
    const response = await fetch(`${running.baseUrl}/admin/brands`, {
      headers: { authorization: "Bearer anything", "x-api-key": "anything" },
    });
    expect(response.status).toBe(401);
  });

  it("has no side effects: nothing was created", async () => {
    const result = await pool.query("select count(*)::int as count from brand where slug = $1", [
      "auth-spec-nope",
    ]);
    expect(result.rows[0].count).toBe(0);
  });

  it("keeps the public health endpoint open", async () => {
    expect((await fetch(`${running.baseUrl}/health`)).status).toBe(200);
  });
});

describe("brands routes when the authenticator fails", () => {
  it("fails closed with 500 internal_error and logs the cause", async () => {
    const logged = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const running = await startApp({
      adminAuthenticator: { authenticate: () => Promise.reject(new Error("token store down")) },
    });
    try {
      const result = await http<ProblemBody>(running.baseUrl, "GET", "/admin/brands");
      expect(result.status).toBe(500);
      expect(result.body).toMatchObject({ code: "internal_error" });
      expect(JSON.stringify(result.body)).not.toContain("token store");
      expect(
        logged.mock.calls.some(([message]) => String(message).includes("token store down")),
      ).toBe(true);
    } finally {
      logged.mockRestore();
      await running.app.close();
    }
  });
});

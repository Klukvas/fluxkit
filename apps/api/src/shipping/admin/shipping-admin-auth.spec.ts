import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { testShippingProviders } from "../../test/test-shipping-provider.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { SOME_ID } from "../../test/routes.js";

const routes = [
  ["GET", "/admin/shipping/methods", undefined],
  [
    "POST",
    "/admin/shipping/methods",
    {
      code: "m5auth_nope",
      title: { uk: "x" },
      kind: "address",
      pricing: { type: "flat", amount: 1 },
      countryCodes: ["UA"],
    },
  ],
  ["GET", `/admin/shipping/methods/${SOME_ID}`, undefined],
  ["PATCH", `/admin/shipping/methods/${SOME_ID}`, { isActive: true }],
  ["DELETE", `/admin/shipping/methods/${SOME_ID}`, undefined],
  ["GET", "/admin/shipping/providers/fake/settings", undefined],
  ["PUT", "/admin/shipping/providers/fake/settings", { settings: { m5auth: true } }],
  ["POST", "/admin/shipping/providers/fake/check", undefined],
] as const;

describe("shipping routes behind the real default guard and the CSRF rule", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let anonymous: RunningApp;
  let owner: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    anonymous = await startApp({
      adminAuthenticator: "production-default",
      extraShippingProviders: testShippingProviders(),
    });
    owner = await startApp({ extraShippingProviders: testShippingProviders() });
  });

  afterAll(async () => {
    await anonymous.app.close();
    await owner.app.close();
    await pool.end();
  });

  it.each(routes)("%s %s answers 401 without a session", async (method, path, body) => {
    const result = await http<ProblemBody>(anonymous.baseUrl, method, path, { body });
    expect(result.status).toBe(401);
    expect(result.headers.get("content-type")).toContain("application/problem+json");
    expect(result.body).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it.each(routes.filter(([method]) => method !== "GET"))(
    "%s %s answers 403 without the CSRF header, even for an owner, and does nothing",
    async (method, path, body) => {
      const result = await http<ProblemBody>(owner.baseUrl, method, path, { body, csrf: false });
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ code: "forbidden" });
    },
  );

  it("has no side effects: nothing was created or saved", async () => {
    const methods = await pool.query(
      "select count(*)::int as count from shipping_method where code = 'm5auth_nope'",
    );
    expect(methods.rows[0].count).toBe(0);
    const settings = await pool.query(
      "select count(*)::int as count from shipping_provider_setting where settings ? 'm5auth'",
    );
    expect(settings.rows[0].count).toBe(0);
  });

  it("sends Cache-Control: no-store on shipping answers, errors included", async () => {
    for (const [path, status] of [
      ["/admin/shipping/methods", 200],
      [`/admin/shipping/methods/${SOME_ID}`, 404],
    ] as const) {
      const result = await http(owner.baseUrl, "GET", path);
      expect(result.status).toBe(status);
      expect(result.headers.get("cache-control")).toBe("no-store");
    }
  });
});

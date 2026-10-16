import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../../common/problem.filter.js";
import { startApp, type RunningApp } from "../../test/app.js";
import { requireTestDatabaseUrl } from "../../test/env.js";
import { http } from "../../test/http.js";
import { defaultLocationId, insertLocation } from "../../test/inventory-fixtures.js";
import { ensureMigrated } from "../../test/migrate.js";
import type { LocationListResponse } from "./locations.schemas.js";

describe("GET /admin/locations (real app, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let running: RunningApp;
  let extraId = "";

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp();
    extraId = await insertLocation(pool, `zz_loc_${Date.now()}`);
  });

  afterAll(async () => {
    await running.app.close();
    await pool.query("delete from location where id = $1", [extraId]);
    await pool.end();
  });

  it("lists the locations with the default one flagged, ordered by code", async () => {
    const mainId = await defaultLocationId(pool);
    const result = await http<LocationListResponse>(running.baseUrl, "GET", "/admin/locations");
    expect(result.status).toBe(200);
    const codes = result.body.items.map((item) => item.code);
    expect(codes).toEqual([...codes].sort());
    expect(result.body.items.find((item) => item.code === "main")).toEqual({
      id: mainId,
      code: "main",
      name: "Main",
      isDefault: true,
    });
    expect(result.body.items.find((item) => item.id === extraId)).toMatchObject({
      isDefault: false,
    });
    expect(result.body.items.filter((item) => item.isDefault)).toHaveLength(1);
  });

  it("is read-only: other methods are not routes", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const result = await http<ProblemBody>(running.baseUrl, method, "/admin/locations", {
        body: method === "DELETE" ? undefined : {},
      });
      expect(result.status, method).toBe(404);
    }
  });

  it("lets a viewer read it", async () => {
    const viewer = await startApp({ adminPrincipal: { role: "viewer" } });
    try {
      expect((await http(viewer.baseUrl, "GET", "/admin/locations")).status).toBe(200);
    } finally {
      await viewer.app.close();
    }
  });

  it("answers 401 without a session", async () => {
    const anonymous = await startApp({ adminAuthenticator: "production-default" });
    try {
      const result = await http<ProblemBody>(anonymous.baseUrl, "GET", "/admin/locations");
      expect(result.status).toBe(401);
      expect(result.body).toMatchObject({ code: "unauthorized" });
    } finally {
      await anonymous.app.close();
    }
  });
});

import { Controller, Delete, Get, Module, Post } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { adminRoutes, SOME_ID } from "../test/routes.js";
import type { AdminAuthenticator } from "./admin-authenticator.js";

/** A controller written by someone who forgot `@AdminController`: the global guard must still protect it. */
@Controller("admin/probe")
class ForgottenGuardController {
  @Get()
  list(): { leaked: true } {
    return { leaked: true };
  }

  @Post("nested/deep")
  create(): { leaked: true } {
    return { leaked: true };
  }

  @Delete(":id")
  remove(): { leaked: true } {
    return { leaked: true };
  }
}

@Module({ controllers: [ForgottenGuardController] })
class ProbeFeatureModule {}

const probeFeature = [{ name: "probe", module: ProbeFeatureModule }];

describe("admin default deny (global guard)", () => {
  let running: RunningApp;
  let probe: RunningApp;
  let signedInViewer: RunningApp;
  let signedInOwner: RunningApp;
  let probeCalls = 0;

  beforeAll(async () => {
    // Every HTTP spec migrates first: schema specs leave the shared database empty, so file order must not matter.
    await ensureMigrated();
    running = await startApp({ adminAuthenticator: "production-default" });
    const countingDeny: AdminAuthenticator = {
      authenticate: () => {
        probeCalls += 1;
        return undefined;
      },
    };
    probe = await startApp({ extraFeatures: probeFeature, adminAuthenticator: countingDeny });
    signedInViewer = await startApp({
      extraFeatures: probeFeature,
      adminPrincipal: { role: "viewer" },
    });
    signedInOwner = await startApp({ extraFeatures: probeFeature });
  });

  afterAll(async () => {
    for (const started of [running, probe, signedInViewer, signedInOwner]) {
      await started.app.close();
    }
  });

  it("answers 401 on EVERY registered /admin route of the real router (real authenticator, no cookie)", async () => {
    const admin = adminRoutes(running.app);
    expect(admin.length).toBeGreaterThan(50);
    let guarded = 0;
    for (const { method, path } of admin) {
      // The only route that is public on purpose; it is asserted separately below.
      if (method === "POST" && path === "/admin/auth/login") continue;
      guarded += 1;
      const result = await http<ProblemBody>(
        running.baseUrl,
        method as "GET",
        path,
        method === "GET" || method === "DELETE" ? {} : { body: {} },
      );
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(result.body, `${method} ${path}`).toMatchObject({ code: "unauthorized" });
    }
    expect(guarded).toBe(admin.length - 1);
  });

  it("lets only POST /admin/auth/login reach its handler without a session (a 400 for an empty body, not a 401)", async () => {
    const result = await http<ProblemBody>(running.baseUrl, "POST", "/admin/auth/login", {
      body: {},
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: "validation_failed" });
  });

  it("stays 401 with a malformed, unknown or foreign cookie and with Authorization or API-key headers", async () => {
    const attempts: Record<string, string>[] = [
      { cookie: "fluxkit_admin_session=garbage" },
      { cookie: `fluxkit_admin_session=${"A".repeat(43)}` },
      { cookie: "other=1" },
      { authorization: "Bearer anything", "x-api-key": "anything" },
    ];
    for (const headers of attempts) {
      const result = await http<ProblemBody>(running.baseUrl, "GET", "/admin/brands", { headers });
      expect(result.status, JSON.stringify(headers)).toBe(401);
    }
  });

  it("denies a plain @Controller('admin/probe') that forgot @AdminController: 401 when anonymous", async () => {
    for (const [method, path] of [
      ["GET", "/admin/probe"],
      ["POST", "/admin/probe/nested/deep"],
      ["DELETE", `/admin/probe/${SOME_ID}`],
      ["GET", "/ADMIN/probe"],
      ["GET", "/admin/probe/"],
    ] as const) {
      const result = await http<ProblemBody>(probe.baseUrl, method, path, {});
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(JSON.stringify(result.body)).not.toContain("leaked");
    }
  });

  it.each([
    ["viewer", () => signedInViewer],
    ["owner", () => signedInOwner],
  ])(
    "denies the same probe routes with 403 forbidden when signed in as %s (no permission metadata)",
    async (_role, app) => {
      for (const [method, path] of [
        ["GET", "/admin/probe"],
        ["POST", "/admin/probe/nested/deep"],
        ["DELETE", `/admin/probe/${SOME_ID}`],
        ["GET", "/ADMIN/probe"],
        ["GET", "/admin/probe/"],
      ] as const) {
        const result = await http<ProblemBody>(app().baseUrl, method, path, {});
        expect(result.status, `${method} ${path}`).toBe(403);
        expect(result.body, `${method} ${path}`).toMatchObject({ code: "forbidden" });
        expect(JSON.stringify(result.body)).not.toContain("leaked");
      }
    },
  );

  it("asks the authenticator once per request, also for @AdminController routes", async () => {
    probeCalls = 0;
    expect((await http(probe.baseUrl, "GET", "/admin/brands")).status).toBe(401);
    expect(probeCalls).toBe(1);
    probeCalls = 0;
    expect((await http(probe.baseUrl, "GET", "/admin/probe")).status).toBe(401);
    expect(probeCalls).toBe(1);
  });

  it("does not guard routes outside /admin", async () => {
    probeCalls = 0;
    expect((await http(probe.baseUrl, "GET", "/health")).status).not.toBe(401);
    expect((await http(probe.baseUrl, "GET", "/administrator")).status).toBe(404);
    expect(probeCalls).toBe(0);
  });
});

import { Controller, Delete, Get, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireEnv } from "../test/env.js";
import { http } from "../test/http.js";
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

const SOME_ID = "6f1c1d2e-8b43-4f4e-9c55-0a1b2c3d4e5f";

interface ExpressLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Every `METHOD path` registered on the real Express router, with params filled in. */
function registeredRoutes(app: NestExpressApplication): { method: string; path: string }[] {
  const router = (app.getHttpAdapter().getInstance() as { router: { stack: ExpressLayer[] } })
    .router;
  const routes: { method: string; path: string }[] = [];
  for (const layer of router.stack) {
    if (layer.route === undefined) continue;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push({
        method: method.toUpperCase(),
        path: layer.route.path.replace(/:[A-Za-z]+/g, SOME_ID),
      });
    }
  }
  return routes;
}

describe("admin default deny (global guard)", () => {
  let running: RunningApp;
  let probe: NestExpressApplication;
  let probeUrl: string;
  let probeCalls = 0;

  beforeAll(async () => {
    running = await startApp({ adminAuthenticator: "production-default" });
    const countingDeny: AdminAuthenticator = {
      allows: () => {
        probeCalls += 1;
        return false;
      },
    };
    probe = await NestFactory.create<NestExpressApplication>(
      AppModule.register({
        databaseUrl: requireEnv("DATABASE_URL"),
        features: [{ name: "probe", module: ProbeFeatureModule }],
        locale: { defaultLocale: "uk", locales: ["uk", "en"] },
        adminAuthenticator: countingDeny,
      }),
      { logger: false },
    );
    await probe.listen(0, "127.0.0.1");
    probeUrl = `http://127.0.0.1:${(probe.getHttpServer().address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await running.app.close();
    await probe.close();
  });

  it("answers 401 on EVERY registered /admin route of the real router", async () => {
    const admin = registeredRoutes(running.app).filter(({ path }) => path.startsWith("/admin"));
    expect(admin.length).toBeGreaterThan(50);
    for (const { method, path } of admin) {
      const result = await http<ProblemBody>(
        running.baseUrl,
        method as "GET",
        path,
        method === "GET" || method === "DELETE" ? {} : { body: {} },
      );
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(result.body, `${method} ${path}`).toMatchObject({ code: "unauthorized" });
    }
  });

  it("denies a plain @Controller('admin/probe') that forgot @AdminController", async () => {
    for (const [method, path] of [
      ["GET", "/admin/probe"],
      ["POST", "/admin/probe/nested/deep"],
      ["DELETE", `/admin/probe/${SOME_ID}`],
      ["GET", "/ADMIN/probe"],
      ["GET", "/admin/probe/"],
    ] as const) {
      const result = await http<ProblemBody>(probeUrl, method, path, {});
      expect(result.status, `${method} ${path}`).toBe(401);
      expect(JSON.stringify(result.body)).not.toContain("leaked");
    }
  });

  it("asks the authenticator once per request, also for @AdminController routes", async () => {
    probeCalls = 0;
    expect((await http(probeUrl, "GET", "/admin/brands")).status).toBe(401);
    expect(probeCalls).toBe(1);
    probeCalls = 0;
    expect((await http(probeUrl, "GET", "/admin/probe")).status).toBe(401);
    expect(probeCalls).toBe(1);
  });

  it("does not guard routes outside /admin", async () => {
    probeCalls = 0;
    expect((await http(probeUrl, "GET", "/health")).status).not.toBe(401);
    expect((await http(probeUrl, "GET", "/administrator")).status).toBe(404);
    expect(probeCalls).toBe(0);
  });
});

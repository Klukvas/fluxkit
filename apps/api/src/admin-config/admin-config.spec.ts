import { CURRENCIES, CURRENCY_CODES, type AdminRole } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import { startMediaApp } from "../test/media-app.js";
import { ensureMigrated } from "../test/migrate.js";

const ROLES: readonly AdminRole[] = ["owner", "manager", "viewer"];

describe("GET /admin/config (real app, real Postgres)", () => {
  const apps = {} as Record<AdminRole, RunningApp>;
  let configured: RunningApp;
  let anonymous: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    for (const role of ROLES) {
      apps[role] = await startApp({ adminPrincipal: { role } });
    }
    configured = await startApp({
      shopCurrency: "KWD",
      pricesIncludeTax: false,
      lowStockThreshold: 0,
      defaultLocale: "en",
      locales: ["en", "uk", "pl"],
    });
    anonymous = await startApp({ adminAuthenticator: "production-default" });
  });

  afterAll(async () => {
    for (const started of [...Object.values(apps), configured, anonymous]) {
      await started.app.close();
    }
  });

  it("answers the defaults of the environment, every field and nothing else", async () => {
    const result = await http(apps.owner.baseUrl, "GET", "/admin/config");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      defaultLocale: "uk",
      locales: ["uk", "en"],
      shopCurrency: "UAH",
      currencyExponent: 2,
      supportedCurrencies: CURRENCY_CODES.map((code) => ({ code, exponent: CURRENCIES[code] })),
      pricesIncludeTax: true,
      lowStockThreshold: 5,
      // The specs run without a media driver (an environment-less app has uploads switched off).
      media: {
        uploadsEnabled: false,
        maxBytes: 10 * 1024 * 1024,
        contentTypes: ["image/jpeg", "image/png", "image/webp"],
      },
    });
  });

  it("reports uploads as enabled with the local driver, with the configured byte limit", async () => {
    const media = await startMediaApp({ mediaMaxBytes: 2048 });
    try {
      const result = await http<{ media: unknown }>(media.baseUrl, "GET", "/admin/config");
      expect(result.status).toBe(200);
      expect(result.body.media).toEqual({
        uploadsEnabled: true,
        maxBytes: 2048,
        contentTypes: ["image/jpeg", "image/png", "image/webp"],
      });
    } finally {
      await media.close();
    }
  });

  it("reflects the configured locales, shop currency (with ITS exponent), tax flag and threshold", async () => {
    const result = await http(configured.baseUrl, "GET", "/admin/config");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      defaultLocale: "en",
      locales: ["en", "uk", "pl"],
      shopCurrency: "KWD",
      currencyExponent: 3,
      pricesIncludeTax: false,
      lowStockThreshold: 0,
    });
  });

  it("lists the supported currencies with the minor-unit exponent of each (zero and three digit ones included)", async () => {
    const result = await http<{ supportedCurrencies: { code: string; exponent: number }[] }>(
      apps.owner.baseUrl,
      "GET",
      "/admin/config",
    );
    const byCode = new Map(result.body.supportedCurrencies.map((entry) => [entry.code, entry]));
    expect(byCode.get("JPY")?.exponent).toBe(0);
    expect(byCode.get("KWD")?.exponent).toBe(3);
    expect(byCode.get("UAH")?.exponent).toBe(2);
  });

  it.each(ROLES)("is open to any signed-in admin: %s", async (role) => {
    const result = await http(apps[role].baseUrl, "GET", "/admin/config");
    expect(result.status).toBe(200);
  });

  it("is not cacheable (every /admin response carries no-store)", async () => {
    const result = await http(apps.owner.baseUrl, "GET", "/admin/config");
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 401 without a session", async () => {
    const result = await http<ProblemBody>(anonymous.baseUrl, "GET", "/admin/config");
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: "unauthorized" });
  });

  it("answers 401 with a cookie that is no session", async () => {
    const result = await http<ProblemBody>(anonymous.baseUrl, "GET", "/admin/config", {
      headers: { cookie: "fluxkit_admin_session=not-a-session" },
    });
    expect(result.status).toBe(401);
  });
});

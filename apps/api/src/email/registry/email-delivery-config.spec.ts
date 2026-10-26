import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { testEmailProviders } from "../../test/test-email-provider.js";

describe("emailDelivery in GET /store/config and GET /admin/config (real app, real Postgres)", () => {
  let without: RunningApp;
  let withProvider: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    without = await startApp();
    withProvider = await startApp({ extraEmailProviders: testEmailProviders() });
  });

  afterAll(async () => {
    await without.app.close();
    await withProvider.app.close();
  });

  it("is false for both routes when no provider is configured (EMAIL_PROVIDER=none)", async () => {
    const store = await http<{ emailDelivery: boolean }>(without.baseUrl, "GET", "/store/config");
    const admin = await http<{ emailDelivery: boolean }>(without.baseUrl, "GET", "/admin/config");
    expect(store.status).toBe(200);
    expect(store.body.emailDelivery).toBe(false);
    expect(admin.status).toBe(200);
    expect(admin.body.emailDelivery).toBe(false);
  });

  it("is true for both routes when a provider is configured", async () => {
    const store = await http<{ emailDelivery: boolean }>(
      withProvider.baseUrl,
      "GET",
      "/store/config",
    );
    const admin = await http<{ emailDelivery: boolean }>(
      withProvider.baseUrl,
      "GET",
      "/admin/config",
    );
    expect(store.body.emailDelivery).toBe(true);
    expect(admin.body.emailDelivery).toBe(true);
  });

  it("is the only thing the flag adds: no provider code, sender or key reaches either route", async () => {
    for (const path of ["/store/config", "/admin/config"]) {
      const result = await http(withProvider.baseUrl, "GET", path);
      expect(JSON.stringify(result.body)).not.toMatch(/fake|provider|from|reply/i);
      expect(Object.keys(result.body as object)).toContain("emailDelivery");
    }
  });
});

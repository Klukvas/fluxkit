import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import { testPaymentProviders } from "../../test/test-payment-provider.js";

describe("onlinePayment in GET /store/config and GET /admin/config (real app, real Postgres)", () => {
  let without: RunningApp;
  let withProvider: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    without = await startApp();
    withProvider = await startApp({ extraPaymentProviders: testPaymentProviders() });
  });

  afterAll(async () => {
    await without.app.close();
    await withProvider.app.close();
  });

  it("is false for both routes when no provider is enabled (PAYMENT_PROVIDERS_ENABLED empty)", async () => {
    const store = await http<{ onlinePayment: boolean }>(without.baseUrl, "GET", "/store/config");
    const admin = await http<{ onlinePayment: boolean }>(without.baseUrl, "GET", "/admin/config");
    expect(store.status).toBe(200);
    expect(store.body.onlinePayment).toBe(false);
    expect(admin.status).toBe(200);
    expect(admin.body.onlinePayment).toBe(false);
  });

  it("is true for both routes when a provider is enabled", async () => {
    const store = await http<{ onlinePayment: boolean }>(
      withProvider.baseUrl,
      "GET",
      "/store/config",
    );
    const admin = await http<{ onlinePayment: boolean }>(
      withProvider.baseUrl,
      "GET",
      "/admin/config",
    );
    expect(store.body.onlinePayment).toBe(true);
    expect(admin.body.onlinePayment).toBe(true);
  });

  it("is a plain boolean: no provider code, token or URL reaches either route", async () => {
    for (const path of ["/store/config", "/admin/config"]) {
      const result = await http(withProvider.baseUrl, "GET", path);
      const keys = Object.keys(result.body as object);
      expect(keys).toContain("onlinePayment");
      expect(keys.filter((key) => /payment/i.test(key))).toEqual(["onlinePayment"]);
      expect(JSON.stringify(result.body)).not.toMatch(/fake|monobank|token|webhook|invoice/i);
    }
  });

  it("the email flag and the payment flag are independent", async () => {
    const store = await http<{ onlinePayment: boolean; emailDelivery: boolean }>(
      withProvider.baseUrl,
      "GET",
      "/store/config",
    );
    expect(store.body.emailDelivery).toBe(false);
    expect(store.body.onlinePayment).toBe(true);
  });

  it("refuses to start when the same provider code is mounted twice", async () => {
    await expect(
      startApp({ extraPaymentProviders: [...testPaymentProviders(), ...testPaymentProviders()] }),
    ).rejects.toThrow(/Payment provider "fake" is loaded twice/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createIntegrationProviderFixture,
  type IntegrationProviderFixture,
} from "../test/integration-provider-fixture.js";
import { InstalledIntegrations, IntegrationUnavailableError } from "./installed-integrations.js";
import type { IntegrationsConfig } from "./integrations.config.js";

describe("InstalledIntegrations", () => {
  let fixture: IntegrationProviderFixture;
  const configOf = (overrides: Partial<IntegrationsConfig> = {}): IntegrationsConfig => ({
    keyRing: null,
    providersDir: fixture.dir,
    isProduction: false,
    environment: {},
    emailRouteDelegated: false,
    emailFromAddress: null,
    paymentDelegated: false,
    shippingDelegated: false,
    shopCurrency: "UAH",
    orderPaymentTtlMinutes: 30,
    storefrontPublicUrl: null,
    ...overrides,
  });

  beforeAll(async () => {
    fixture = await createIntegrationProviderFixture();
  });
  afterAll(async () => {
    await fixture.remove();
  });

  it("lists the installed packages that declare secrets, enabled or not, and nothing else", async () => {
    const installed = await new InstalledIntegrations(configOf()).list();
    expect(installed.map((entry) => `${entry.kind}/${entry.providerCode}`)).toEqual([
      "email/asyncmail",
      "email/brokenmail",
      "email/fake",
      "email/testmail",
      "payment/testpay",
    ]);
    expect(installed.find((entry) => entry.providerCode === "testmail")?.secrets).toEqual([
      { field: "api_key", purpose: "outbound", envVariable: "TESTMAIL_API_KEY" },
      { field: "webhook_secret", purpose: "webhook", envVariable: "TESTMAIL_WEBHOOK_SECRET" },
    ]);
  });

  it("does not offer a test-only provider in production", async () => {
    const installed = await new InstalledIntegrations(configOf({ isProduction: true })).list();
    expect(installed.map((entry) => entry.providerCode)).not.toContain("fake");
    expect(installed.map((entry) => entry.providerCode)).toContain("testmail");
  });

  it("offers nothing when the folder does not exist or none is configured", async () => {
    expect(await new InstalledIntegrations(configOf({ providersDir: "" })).list()).toEqual([]);
    expect(
      await new InstalledIntegrations(configOf({ providersDir: `${fixture.dir}/missing` })).list(),
    ).toEqual([]);
  });

  it("treats a blank variable as not set and any other value as an override", async () => {
    const installed = new InstalledIntegrations(
      configOf({ environment: { TESTMAIL_API_KEY: "  ", TESTMAIL_WEBHOOK_SECRET: "x" } }),
    );
    const testmail = await installed.find("email", "testmail");
    const [apiKey, webhook] = testmail?.secrets ?? [];
    if (apiKey === undefined || webhook === undefined) throw new Error("fixture");
    expect(installed.isSetInEnvironment(apiKey)).toBe(false);
    expect(installed.isSetInEnvironment(webhook)).toBe(true);
  });

  it("finds a provider by kind and code, not by code alone", async () => {
    const installed = new InstalledIntegrations(configOf());
    expect((await installed.find("email", "testmail"))?.providerCode).toBe("testmail");
    expect(await installed.find("payment", "testmail")).toBeUndefined();
  });

  it("asks the plugin's format rule and never echoes the value", async () => {
    const installed = new InstalledIntegrations(configOf());
    const testmail = await installed.find("email", "testmail");
    if (testmail === undefined) throw new Error("fixture");
    expect(
      await installed.validateSecret(testmail, "api_key", "tm_abcdefghijkl0123"),
    ).toBeUndefined();
    const problem = await installed.validateSecret(testmail, "api_key", "wrong-SENTINEL-value");
    expect(problem).toContain("the value is not shown");
    expect(problem).not.toContain("SENTINEL");
  });

  it("accepts any value for a plugin without a format rule", async () => {
    const installed = new InstalledIntegrations(configOf());
    const testpay = await installed.find("payment", "testpay");
    if (testpay === undefined) throw new Error("fixture");
    expect(await installed.validateSecret(testpay, "token", "anything")).toBeUndefined();
  });

  it("does not offer a provider that names a variable outside its own prefix", async () => {
    const installed = new InstalledIntegrations(
      configOf({ environment: { DATABASE_URL: "postgres://example" } }),
    );
    expect(await installed.find("email", "nosymail")).toBeUndefined();
  });

  it("does not read a format rule that answers anything but a string or nothing as accepted", async () => {
    const installed = new InstalledIntegrations(configOf());
    const asyncmail = await installed.find("email", "asyncmail");
    if (asyncmail === undefined) throw new Error("fixture");
    await expect(installed.validateSecret(asyncmail, "api_key", "x")).rejects.toBeInstanceOf(
      IntegrationUnavailableError,
    );
  });

  it("refuses to validate for a package whose entry cannot be loaded", async () => {
    const installed = new InstalledIntegrations(configOf());
    const broken = await installed.find("email", "brokenmail");
    if (broken === undefined) throw new Error("fixture");
    await expect(installed.validateSecret(broken, "api_key", "x")).rejects.toBeInstanceOf(
      IntegrationUnavailableError,
    );
  });
});

import { Global, Injectable, Logger, Module, SetMetadata, type Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAYMENT_PROVIDER_METADATA,
  paymentProviderOk,
  type PaymentProviderCapabilities,
  type PaymentProviderPort,
} from "@fluxkit/core";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import type { LoadedPaymentProvider } from "./payment-provider-loader.js";
import { PaymentProviderRegistry } from "./payment-provider-registry.js";
import { PaymentRegistryModule } from "./payment-registry.module.js";

const UAH_ONLY: PaymentProviderCapabilities = {
  currencies: ["UAH"],
  partialRefunds: true,
  multipleRefunds: true,
  invalidateUnpaid: true,
  webhooks: true,
};

/** A complete provider; the failing variants below are built from it. */
function portOf(code: string): PaymentProviderPort {
  const unused = () => Promise.resolve(paymentProviderOk(undefined as never));
  return {
    code,
    capabilities: UAH_ONLY,
    createPayment: unused,
    getPayment: unused,
    invalidatePayment: unused,
    refund: unused,
    verifyWebhook: unused,
  };
}

function providerModuleOf(
  code: string,
  options: { metadataCode?: string; port?: Partial<PaymentProviderPort> | "none" } = {},
): LoadedPaymentProvider {
  @Injectable()
  @SetMetadata(PAYMENT_PROVIDER_METADATA, { code: options.metadataCode ?? code })
  class TestProvider {
    constructor() {
      if (options.port !== "none") {
        Object.assign(this, portOf(code), options.port);
      }
    }
  }
  @Module({ providers: [TestProvider], exports: [TestProvider] })
  class TestProviderModule {}
  return { code, module: TestProviderModule as Type<unknown> };
}

function pricing(shopCurrency: PricingConfig["shopCurrency"] = "UAH"): Type<unknown> {
  @Global()
  @Module({
    providers: [
      {
        provide: PRICING_CONFIG,
        useValue: { shopCurrency, pricesIncludeTax: true, lowStockThreshold: 5 },
      },
    ],
    exports: [PRICING_CONFIG],
  })
  class PricingStub {}
  return PricingStub;
}

async function boot(
  providers: LoadedPaymentProvider[],
  shopCurrency?: PricingConfig["shopCurrency"],
) {
  const testing = await Test.createTestingModule({
    imports: [pricing(shopCurrency), PaymentRegistryModule.register(providers)],
  }).compile();
  const app = testing.createNestApplication();
  await app.init();
  return app;
}

describe("PaymentProviderRegistry", () => {
  const opened: { close(): Promise<void> }[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (opened.length > 0) {
      await opened.pop()?.close();
    }
  });

  async function start(
    providers: LoadedPaymentProvider[],
    shopCurrency?: PricingConfig["shopCurrency"],
  ) {
    const app = await boot(providers, shopCurrency);
    opened.push(app);
    return app.get(PaymentProviderRegistry);
  }

  it("with none it has no provider, online payment is off and it reports that", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const registry = await start([]);
    expect(registry.list()).toEqual([]);
    expect(registry.get("fake")).toBeUndefined();
    expect(registry.onlineEnabled()).toBe(false);
    expect(log).toHaveBeenCalledWith("Payment providers loaded: none");
  });

  it("registers the enabled providers, exposes them by code and in code order, and reports them", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const registry = await start([providerModuleOf("zeta"), providerModuleOf("alpha")]);
    expect(registry.get("alpha")?.code).toBe("alpha");
    expect(registry.get("zeta")?.code).toBe("zeta");
    expect(registry.get("other")).toBeUndefined();
    expect(registry.list().map((provider) => provider.code)).toEqual(["alpha", "zeta"]);
    expect(registry.onlineEnabled()).toBe(true);
    expect(log).toHaveBeenCalledWith("Payment providers loaded: alpha,zeta");
  });

  it("refuses a code loaded twice before anything starts", () => {
    expect(() =>
      PaymentRegistryModule.register([providerModuleOf("dup"), providerModuleOf("dup")]),
    ).toThrow(/Payment provider "dup" is loaded twice/);
  });

  it("fails startup when two marked classes in one module declare the same code", async () => {
    const first = providerModuleOf("dup");
    const second = providerModuleOf("dup");
    @Module({ imports: [first.module, second.module] })
    class Both {}
    await expect(boot([{ code: "dup", module: Both as Type<unknown> }])).rejects.toThrow(
      /Payment provider code "dup" is declared twice/,
    );
  });

  it.each([
    ["a missing createPayment", { createPayment: undefined }],
    ["a missing getPayment", { getPayment: undefined }],
    ["a missing invalidatePayment", { invalidatePayment: undefined }],
    ["a missing refund", { refund: undefined }],
    ["a missing verifyWebhook", { verifyWebhook: undefined }],
    ["no capabilities", { capabilities: undefined }],
    ["no currencies", { capabilities: { ...UAH_ONLY, currencies: [] } }],
    ["a non-string currency", { capabilities: { ...UAH_ONLY, currencies: [980] } }],
    ["a non-boolean capability", { capabilities: { ...UAH_ONLY, webhooks: "yes" } }],
  ])("fails startup when a marked class has %s", async (_label, port) => {
    await expect(
      boot([providerModuleOf("lame", { port: port as Partial<PaymentProviderPort> })]),
    ).rejects.toThrow(/"lame"\) must be a static provider implementing PaymentProviderPort/);
  });

  it("fails startup when a marked class has no port at all", async () => {
    await expect(boot([providerModuleOf("empty", { port: "none" })])).rejects.toThrow(
      /"empty"\) must be a static provider implementing PaymentProviderPort/,
    );
  });

  it("fails startup when the class code differs from its metadata", async () => {
    await expect(boot([providerModuleOf("one", { metadataCode: "two" })])).rejects.toThrow(
      /its code "one" differs from the code "two"/,
    );
  });

  it("fails startup when the metadata carries a malformed code", async () => {
    await expect(boot([providerModuleOf("x", { metadataCode: "Bad-Code" })])).rejects.toThrow(
      /declares an invalid code/,
    );
  });

  it("fails startup when an enabled provider's module has no marked provider (not a provider)", async () => {
    @Injectable()
    class Plain {}
    @Module({ providers: [Plain] })
    class NotAProviderModule {}
    await expect(
      boot([{ code: "plain", module: NotAProviderModule as Type<unknown> }]),
    ).rejects.toThrow(/Payment provider "plain" is enabled but its module contains no provider/);
  });

  it("fails startup when the module holds a provider of another code than the enabled one", async () => {
    const stray = providerModuleOf("stray");
    await expect(boot([{ code: "wanted", module: stray.module }])).rejects.toThrow(
      /Payment provider "wanted" is enabled but its module contains no provider/,
    );
  });

  it("fails startup when a marked provider exists although nothing is enabled", async () => {
    // Mounted by something other than the loader: the registry expects none, so the stray one is refused.
    const stray = providerModuleOf("stray");
    @Module({ imports: [stray.module] })
    class Mounted {}
    const dynamic = PaymentRegistryModule.register([]);
    const testing = Test.createTestingModule({
      imports: [pricing(), { ...dynamic, imports: [...(dynamic.imports ?? []), Mounted] }],
    });
    const app = (await testing.compile()).createNestApplication();
    await expect(app.init()).rejects.toThrow(
      /Payment provider "stray" was found but is not enabled in PAYMENT_PROVIDERS_ENABLED/,
    );
    await app.close();
  });

  it("fails startup when a found provider is not among the enabled ones", async () => {
    const wanted = providerModuleOf("wanted");
    const other = providerModuleOf("other");
    @Module({ imports: [wanted.module, other.module] })
    class Both {}
    await expect(boot([{ code: "wanted", module: Both as Type<unknown> }])).rejects.toThrow(
      /"other" was found but is not enabled/,
    );
  });

  it("fails startup when an enabled provider does not take the shop currency, naming both", async () => {
    await expect(boot([providerModuleOf("uah")], "EUR")).rejects.toThrow(
      /Payment provider "uah" does not take the shop currency EUR \(SHOP_CURRENCY\); it takes UAH/,
    );
  });

  it("accepts a provider that lists the shop currency among several", async () => {
    const many = providerModuleOf("many", {
      port: { capabilities: { ...UAH_ONLY, currencies: ["UAH", "EUR"] } },
    });
    const registry = await start([many], "EUR");
    expect(registry.get("many")?.code).toBe("many");
  });
});

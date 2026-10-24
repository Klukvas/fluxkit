import { Injectable, Logger, Module, SetMetadata, type Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  providerOk,
  SHIPPING_PROVIDER_METADATA,
  shippingProviderMetadata,
  type ShippingProviderPort,
} from "@fluxkit/core";
import type { LoadedShippingProvider } from "./shipping-provider-loader.js";
import { ShippingProviderRegistry } from "./shipping-provider-registry.js";
import { ShippingRegistryModule } from "./shipping-registry.module.js";

/** A complete provider; the failing variants below are built from it. */
function portOf(code: string): ShippingProviderPort {
  const unused = (): never => {
    throw new Error("not used by this spec");
  };
  return {
    code,
    capabilities: {
      pickupPoints: false,
      estimate: false,
      waybills: false,
      cancelWaybill: false,
      tracking: false,
      labels: false,
    },
    searchCities: unused,
    listPickupPoints: unused,
    estimate: unused,
    createWaybill: unused,
    findWaybill: unused,
    cancelWaybill: unused,
    track: unused,
    fetchLabel: unused,
    checkConnection: () => Promise.resolve(providerOk(undefined)),
  };
}

function providerModuleOf(
  code: string,
  options: { metadataCode?: string; port?: Partial<ShippingProviderPort> | "none" } = {},
): LoadedShippingProvider {
  @Injectable()
  @SetMetadata(SHIPPING_PROVIDER_METADATA, { code: options.metadataCode ?? code })
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

async function boot(providers: LoadedShippingProvider[]) {
  const testing = await Test.createTestingModule({
    imports: [ShippingRegistryModule.register(providers)],
  }).compile();
  const app = testing.createNestApplication();
  await app.init();
  return app;
}

describe("ShippingProviderRegistry", () => {
  const opened: { close(): Promise<void> }[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (opened.length > 0) {
      await opened.pop()?.close();
    }
  });

  async function start(providers: LoadedShippingProvider[]) {
    const app = await boot(providers);
    opened.push(app);
    return app.get(ShippingProviderRegistry);
  }

  it("with nothing enabled it is empty and reports that", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const registry = await start([]);
    expect(registry.list()).toEqual([]);
    expect(registry.get("fake")).toBeUndefined();
    expect(log).toHaveBeenCalledWith("Shipping providers loaded: none");
  });

  it("registers an enabled provider, finds it by code and reports it", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const registry = await start([providerModuleOf("zeta"), providerModuleOf("alpha")]);
    expect(registry.get("alpha")?.code).toBe("alpha");
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.list().map((provider) => provider.code)).toEqual(["alpha", "zeta"]);
    expect(log).toHaveBeenCalledWith("Shipping providers loaded: alpha,zeta");
  });

  it("fails startup when two providers declare the same code", async () => {
    await expect(boot([providerModuleOf("dup"), providerModuleOf("dup")])).rejects.toThrow(
      /Shipping provider code "dup" is declared twice/,
    );
  });

  it("fails startup when a marked class does not implement the port", async () => {
    await expect(
      boot([providerModuleOf("lame", { port: { estimate: undefined } })]),
    ).rejects.toThrow(/"lame"\) must be a static provider implementing ShippingProviderPort/);
    await expect(boot([providerModuleOf("empty", { port: "none" })])).rejects.toThrow(
      /"empty"\) must be a static provider implementing ShippingProviderPort/,
    );
    await expect(
      boot([providerModuleOf("nocaps", { port: { capabilities: undefined } })]),
    ).rejects.toThrow(/must be a static provider implementing ShippingProviderPort/);
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
    ).rejects.toThrow(/Shipping provider "plain" is enabled but its module contains no provider/);
  });

  it("fails startup when a marked provider is found that was not enabled", async () => {
    @Injectable()
    @SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata("stray"))
    class Stray {
      readonly code = "stray";
    }
    Object.assign(Stray.prototype, portOf("stray"));
    @Module({ providers: [Stray] })
    class StrayModule {}
    // The module is mounted by something other than the loader (here: as another provider's module) but its code is not
    // in the enabled list.
    const wrapper = providerModuleOf("wanted");
    @Module({ imports: [wrapper.module, StrayModule] })
    class Both {}
    await expect(boot([{ code: "wanted", module: Both as Type<unknown> }])).rejects.toThrow(
      /"stray" was found but is not enabled/,
    );
  });
});

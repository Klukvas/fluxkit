import { Injectable, Logger, Module, SetMetadata, type Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_PROVIDER_METADATA, emailProviderOk, type EmailProviderPort } from "@fluxkit/core";
import type { LoadedEmailProvider } from "./email-provider-loader.js";
import { EmailProviderRegistry } from "./email-provider-registry.js";
import { EmailRegistryModule } from "./email-registry.module.js";

/** A complete provider; the failing variants below are built from it. */
function portOf(code: string): EmailProviderPort {
  return {
    code,
    capabilities: { idempotencyKeys: true, maxRecipients: 1 },
    send: () => Promise.resolve(emailProviderOk({ providerMessageId: "id-1" })),
  };
}

function providerModuleOf(
  code: string,
  options: { metadataCode?: string; port?: Partial<EmailProviderPort> | "none" } = {},
): LoadedEmailProvider {
  @Injectable()
  @SetMetadata(EMAIL_PROVIDER_METADATA, { code: options.metadataCode ?? code })
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

async function boot(providers: LoadedEmailProvider[]) {
  const testing = await Test.createTestingModule({
    imports: [EmailRegistryModule.register(providers)],
  }).compile();
  const app = testing.createNestApplication();
  await app.init();
  return app;
}

describe("EmailProviderRegistry", () => {
  const opened: { close(): Promise<void> }[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (opened.length > 0) {
      await opened.pop()?.close();
    }
  });

  async function start(providers: LoadedEmailProvider[]) {
    const app = await boot(providers);
    opened.push(app);
    return app.get(EmailProviderRegistry);
  }

  it("with none it has no provider, delivers nothing and reports that", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const registry = await start([]);
    expect(registry.get()).toBeUndefined();
    expect(registry.deliveryEnabled()).toBe(false);
    expect(log).toHaveBeenCalledWith("Email provider loaded: none");
  });

  it("registers the selected provider, exposes it and reports its code", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const registry = await start([providerModuleOf("alpha")]);
    expect(registry.get()?.code).toBe("alpha");
    expect(registry.deliveryEnabled()).toBe(true);
    expect(log).toHaveBeenCalledWith("Email provider loaded: alpha");
  });

  it("refuses two loaded providers: exactly one is active", () => {
    expect(() =>
      EmailRegistryModule.register([providerModuleOf("one"), providerModuleOf("two")]),
    ).toThrow(/Only one email provider can be active, but 2 were loaded \(one, two\)/);
    expect(() =>
      EmailRegistryModule.register([providerModuleOf("dup"), providerModuleOf("dup")]),
    ).toThrow(/Only one email provider can be active/);
  });

  it("fails startup when two marked classes in one module declare the same code", async () => {
    const first = providerModuleOf("dup");
    const second = providerModuleOf("dup");
    @Module({ imports: [first.module, second.module] })
    class Both {}
    await expect(boot([{ code: "dup", module: Both as Type<unknown> }])).rejects.toThrow(
      /Email provider code "dup" is declared twice/,
    );
  });

  it("fails startup when a marked class does not implement the port", async () => {
    await expect(boot([providerModuleOf("lame", { port: { send: undefined } })])).rejects.toThrow(
      /"lame"\) must be a static provider implementing EmailProviderPort/,
    );
    await expect(boot([providerModuleOf("empty", { port: "none" })])).rejects.toThrow(
      /"empty"\) must be a static provider implementing EmailProviderPort/,
    );
    await expect(
      boot([providerModuleOf("nocaps", { port: { capabilities: undefined } })]),
    ).rejects.toThrow(/must be a static provider implementing EmailProviderPort/);
    await expect(
      boot([
        providerModuleOf("badcaps", {
          port: { capabilities: { idempotencyKeys: true, maxRecipients: 0 } },
        }),
      ]),
    ).rejects.toThrow(/must be a static provider implementing EmailProviderPort/);
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

  it("fails startup when the selected provider's module has no marked provider (not a provider)", async () => {
    @Injectable()
    class Plain {}
    @Module({ providers: [Plain] })
    class NotAProviderModule {}
    await expect(
      boot([{ code: "plain", module: NotAProviderModule as Type<unknown> }]),
    ).rejects.toThrow(/Email provider "plain" is enabled but its module contains no provider/);
  });

  it("fails startup when the module holds a provider of another code than the selected one", async () => {
    const stray = providerModuleOf("stray");
    await expect(boot([{ code: "wanted", module: stray.module }])).rejects.toThrow(
      /Email provider "wanted" is enabled but its module contains no provider/,
    );
  });

  it("fails startup when a marked provider exists although EMAIL_PROVIDER is none", async () => {
    // Mounted by something other than the loader: the registry expects no provider, so the stray one is refused.
    const stray = providerModuleOf("stray");
    @Module({ imports: [stray.module] })
    class Mounted {}
    const dynamic = EmailRegistryModule.register([]);
    const testing = Test.createTestingModule({
      imports: [{ ...dynamic, imports: [...(dynamic.imports ?? []), Mounted] }],
    });
    const app = (await testing.compile()).createNestApplication();
    await expect(app.init()).rejects.toThrow(/"stray" was found but EMAIL_PROVIDER is none/);
    await app.close();
  });

  it("fails startup when the found provider is not the selected one", async () => {
    const wanted = providerModuleOf("wanted");
    const other = providerModuleOf("other");
    @Module({ imports: [wanted.module, other.module] })
    class Both {}
    await expect(boot([{ code: "wanted", module: Both as Type<unknown> }])).rejects.toThrow(
      /"other" was found but EMAIL_PROVIDER is "wanted"/,
    );
  });
});

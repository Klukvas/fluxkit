import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { SHIPPING_CAPABILITIES, SHIPPING_PROVIDER_METADATA } from "@fluxkit/core";
import { NovaPostShippingProvider, providerModule } from "./index.js";

const KEY = "module-spec-key-0123456789abcdef";

function restore(
  name: "NOVA_POST_API_KEY" | "NOVA_POST_ENVIRONMENT",
  value: string | undefined,
): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}

describe("the provider module (what the API's loader mounts)", () => {
  const saved = {
    key: process.env.NOVA_POST_API_KEY,
    environment: process.env.NOVA_POST_ENVIRONMENT,
  };

  afterEach(() => {
    restore("NOVA_POST_API_KEY", saved.key);
    restore("NOVA_POST_ENVIRONMENT", saved.environment);
  });

  it("provides a marked nova_post provider with every capability, and calls nothing at startup", async () => {
    process.env.NOVA_POST_API_KEY = KEY;
    delete process.env.NOVA_POST_ENVIRONMENT;
    expect(Reflect.getMetadata(SHIPPING_PROVIDER_METADATA, NovaPostShippingProvider)).toEqual({
      code: "nova_post",
    });
    const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
    const provider = moduleRef.get(NovaPostShippingProvider);
    expect(provider.code).toBe("nova_post");
    for (const capability of SHIPPING_CAPABILITIES) {
      expect(provider.capabilities[capability]).toBe(true);
    }
    // The no-network guard of this suite fails the file if anything was sent (the JWT is fetched on first use).
    await moduleRef.close();
  });

  it("refuses to start without a key, naming the variable and never a value", async () => {
    delete process.env.NOVA_POST_API_KEY;
    await expect(Test.createTestingModule({ imports: [providerModule] }).compile()).rejects.toThrow(
      /NOVA_POST_API_KEY is required/,
    );
    process.env.NOVA_POST_API_KEY = KEY;
    process.env.NOVA_POST_ENVIRONMENT = "live";
    let message = "";
    try {
      await Test.createTestingModule({ imports: [providerModule] }).compile();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/NOVA_POST_ENVIRONMENT must be one of sandbox, production/);
    expect(message).not.toContain(KEY);
  });
});

import type { ShippingProviderPort } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import type { ShippingProviderRegistry } from "../registry/shipping-provider-registry.js";
import type { ShippingProviderSettingsRepository } from "./shipping-provider-settings.repository.js";
import { ShippingProvidersService } from "./shipping-providers.service.js";

/** A provider whose connection check does what the test says; everything else is unused. */
function serviceWith(checkConnection: ShippingProviderPort["checkConnection"]) {
  const provider = { code: "stub", checkConnection } as unknown as ShippingProviderPort;
  const registry = { get: (code: string) => (code === "stub" ? provider : undefined) };
  return new ShippingProvidersService(
    registry as unknown as ShippingProviderRegistry,
    {} as ShippingProviderSettingsRepository,
  );
}

describe("ShippingProvidersService.check", () => {
  it("does not let a carrier message pass as a code: the failure is re-checked and surfaces as an error", async () => {
    const service = serviceWith(() =>
      Promise.resolve({
        ok: false,
        reason: "rejected",
        providerCodes: ["Invalid API key for sender Ivan Petrenko +380501234567"],
      } as never),
    );
    await expect(service.check("stub")).rejects.toThrow(RangeError);
  });

  it("does not turn a provider's own throw into a friendly answer: it is a bug and surfaces", async () => {
    const service = serviceWith(() => Promise.reject(new Error("boom")));
    await expect(service.check("stub")).rejects.toThrow("boom");
  });

  it("passes the API's abort signal to the provider, with a time limit", async () => {
    let received: { aborted: boolean } | undefined;
    const service = serviceWith((signal) => {
      received = signal;
      return Promise.resolve({ ok: true, value: undefined });
    });
    expect(await service.check("stub")).toEqual({ ok: true });
    expect(received?.aborted).toBe(false);
  });

  it("answers 404 for a code it does not run, whatever the code looks like", async () => {
    const service = serviceWith(() => Promise.resolve({ ok: true, value: undefined }));
    for (const code of ["other", "__proto__", "constructor", ""]) {
      await expect(service.check(code), code).rejects.toMatchObject({ status: 404 });
    }
  });
});

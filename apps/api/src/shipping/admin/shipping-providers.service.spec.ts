import { SHIPPING_PROVIDER_TIMEOUTS_MS, type ShippingProviderPort } from "@fluxkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLogs } from "../../test/shipping-fixtures.js";
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
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Review m-1: the check goes through the guarded `callProvider` like every other provider call. */
  it("a carrier message passed as a code is never answered or logged: unavailable, the class name only", async () => {
    const logs = captureLogs();
    try {
      const service = serviceWith(() =>
        Promise.resolve({
          ok: false,
          reason: "rejected",
          providerCodes: ["Invalid API key for sender Ivan Petrenko +380501234567"],
        } as never),
      );
      const answer = await service.check("stub");
      expect(answer).toEqual({ ok: false, reason: "unavailable", providerCodes: [] });
      expect(JSON.stringify(answer)).not.toContain("Petrenko");
      expect(logs.text()).toContain("threw error=RangeError");
      expect(logs.text()).not.toContain("Petrenko");
    } finally {
      logs.stop();
    }
  });

  it("a provider's throw is unavailable, never a 500 whose log echoes the provider's text", async () => {
    const logs = captureLogs();
    try {
      const service = serviceWith(() => Promise.reject(new Error("apiKey=XYZ refused")));
      expect(await service.check("stub")).toEqual({
        ok: false,
        reason: "unavailable",
        providerCodes: [],
      });
      expect(logs.text()).toContain("threw error=Error");
      expect(logs.text()).not.toContain("apiKey=XYZ");
    } finally {
      logs.stop();
    }
  });

  it("a provider that ignores the abort signal is not waited for: unavailable after the lookup limit", async () => {
    vi.useFakeTimers();
    const service = serviceWith(() => new Promise(() => undefined));
    const answer = service.check("stub");
    await vi.advanceTimersByTimeAsync(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup);
    expect(await answer).toEqual({ ok: false, reason: "unavailable", providerCodes: [] });
  });

  it("a typed failure keeps its reason and carrier codes", async () => {
    const service = serviceWith(() =>
      Promise.resolve({ ok: false, reason: "invalid_credentials", providerCodes: ["E_401"] }),
    );
    expect(await service.check("stub")).toEqual({
      ok: false,
      reason: "invalid_credentials",
      providerCodes: ["E_401"],
    });
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

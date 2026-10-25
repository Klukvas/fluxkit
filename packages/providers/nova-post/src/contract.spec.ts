import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkShippingProviderContract } from "@fluxkit/core";
import { live, providerOn, VALID_SETTINGS, waybillRequest } from "./test-support/fixtures.js";
import { STUB_CITY_ID, startStubCarrier, type StubCarrier } from "./test-support/stub-carrier.js";

/* The same provider contract check the fake provider passes (core `checkShippingProviderContract`), on the stub carrier. */
describe("NovaPostShippingProvider keeps the provider contract", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("breaks no rule of ShippingProviderPort", async () => {
    const { provider } = providerOn(stub);
    const aborted = new AbortController();
    aborted.abort(new Error("aborted"));
    const violations = await checkShippingProviderContract(provider, {
      cityQuery: { query: "Тест", locale: "uk" },
      cityRef: String(STUB_CITY_ID),
      pickupPointRef: "700005",
      unknownPickupPointRef: "799999",
      waybill: waybillRequest(),
      validSettings: VALID_SETTINGS,
      invalidSettings: { ...VALID_SETTINGS, senderPhone: "+380" },
      liveSignal: live,
      abortedSignal: () => aborted.signal,
    });
    expect(violations).toEqual([]);
  });
});

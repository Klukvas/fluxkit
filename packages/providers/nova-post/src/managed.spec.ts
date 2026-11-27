import { startStubCarrier, STUB_API_KEY, STUB_CITY_ID } from "./test-support/stub-carrier.js";
import { live, VALID_SETTINGS, waybillRequest } from "./test-support/fixtures.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkShippingProviderContract, type ManagedProviderContext } from "@fluxkit/core";
import { createOutboundClient, checkCredentials } from "./index.js";

const context = (environment = "sandbox"): ManagedProviderContext => ({
  kind: "shipping",
  providerCode: "nova_post",
  versionId: "test-version",
  environment,
  now: () => new Date(),
  transport: {
    start: async () => {
      throw Object.assign(new Error("credential_revoked"), {
        name: "CredentialAdmissionDenied",
        code: "credential_revoked",
      });
    },
  },
});
afterEach(() => vi.restoreAllMocks());
describe("managed Nova Post transport", () => {
  it("refuses even JWT acquisition without fetching when the gate denies", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const client = createOutboundClient({ api_key: "invented-api-key-for-test" }, context());
    const result = await client.checkConnection(new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: ["credential_revoked"],
    });
    expect(
      await checkCredentials(
        { api_key: "invented-api-key-for-test" },
        context(),
        new AbortController().signal,
      ),
    ).toEqual({ code: "unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("managed Nova Post client", () => {
  it("keeps the shipping contract with every request gated", async () => {
    const stub = await startStubCarrier();
    const realFetch = globalThis.fetch;
    let gates = 0;
    let requests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      requests++;
      const url = new URL(String(input));
      return realFetch(
        `${stub.baseUrl}${url.pathname.replace(/^\/v\.1\.0/, "")}${url.search}`,
        init,
      );
    });
    try {
      const ctx: ManagedProviderContext = {
        ...context(),
        transport: {
          start: async (signal, begin) => {
            if (signal.aborted) throw new Error("aborted");
            gates++;
            return begin().completion;
          },
        },
      };
      const client = createOutboundClient({ api_key: STUB_API_KEY }, ctx);
      const aborted = new AbortController();
      aborted.abort();
      expect(
        await checkShippingProviderContract(client, {
          cityQuery: { query: "Тест", locale: "uk" },
          cityRef: String(STUB_CITY_ID),
          pickupPointRef: "700005",
          unknownPickupPointRef: "799999",
          waybill: waybillRequest(),
          validSettings: VALID_SETTINGS,
          invalidSettings: { ...VALID_SETTINGS, senderPhone: "+380" },
          liveSignal: live,
          abortedSignal: () => aborted.signal,
        }),
      ).toEqual([]);
      expect(requests).toBeGreaterThan(10);
      expect(requests).toBe(gates);
    } finally {
      await stub.close();
    }
  });
  it("does not reuse a JWT between versions or environments and gates after JWT resolution", async () => {
    const requests: { host: string; path: string; authorization: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      requests.push({
        host: url.host,
        path: url.pathname,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Promise.resolve(
        url.pathname.endsWith("/authorization")
          ? Response.json({ jwt: `jwt-${requests.length}-invented` })
          : Response.json({ items: [], current_page: 1, last_page: 1, per_page: 100, total: 0 }),
      );
    });
    const allowed = (environment: string, versionId: string): ManagedProviderContext => ({
      ...context(environment),
      versionId,
      transport: { start: async (_signal, begin) => begin().completion },
    });
    const a = createOutboundClient({ api_key: "invented-key-same-value" }, allowed("sandbox", "a"));
    const b = createOutboundClient(
      { api_key: "invented-key-same-value" },
      allowed("production", "b"),
    );
    await a.searchCities({ query: "Test", locale: "en", limit: 10 }, live());
    await a.searchCities({ query: "Other", locale: "en", limit: 10 }, live());
    await b.searchCities({ query: "Test", locale: "en", limit: 10 }, live());
    expect(requests.filter((row) => row.path.endsWith("/authorization"))).toHaveLength(2);
    expect(requests.map((row) => row.host)).toEqual([
      "api-stage.novapost.com",
      "api-stage.novapost.com",
      "api-stage.novapost.com",
      "api.novapost.com",
      "api.novapost.com",
    ]);
    expect(requests[1]?.authorization).not.toBe(requests[4]?.authorization);
    let gate = 0;
    const denied = createOutboundClient(
      { api_key: "invented-key-same-value" },
      {
        ...context(),
        transport: {
          start: async (signal, begin) => {
            if (++gate === 2) return context().transport.start(signal, begin);
            return begin().completion;
          },
        },
      },
    );
    const before = requests.length;
    await expect(
      denied.searchCities({ query: "Test", locale: "en", limit: 10 }, live()),
    ).rejects.toMatchObject({ codes: ["credential_revoked"] });
    expect(requests.length - before).toBe(1);
  });
});

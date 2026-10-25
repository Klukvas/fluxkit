import { describe, expect, it } from "vitest";
import { checkShippingProviderContract } from "./provider-contract.js";
import type { ShippingProviderContractScenario } from "./provider-contract.js";
import {
  providerFailure,
  providerOk,
  type PickupPoint,
  type ProviderAbortSignal,
  type ShippingProviderPort,
  type WaybillCreated,
} from "./provider-port.js";

function signal(aborted: boolean): ProviderAbortSignal {
  const reason = new Error("aborted");
  return {
    aborted,
    reason: aborted ? reason : undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    throwIfAborted: () => {
      if (aborted) {
        throw reason;
      }
    },
  };
}

const POINTS: PickupPoint[] = [
  {
    ref: "p1",
    number: "1",
    kind: "branch",
    cityRef: "c1",
    cityName: "Місто",
    countryCode: "UA",
    description: "Відділення 1",
    maxWeightGrams: 30_000,
  },
  {
    ref: "p2",
    number: "2",
    kind: "locker",
    cityRef: "c1",
    cityName: "Місто",
    countryCode: "UA",
    description: "Поштомат 2",
    maxWeightGrams: null,
  },
];

const scenario: ShippingProviderContractScenario = {
  cityQuery: { query: "Мі", locale: "uk" },
  cityRef: "c1",
  pickupPointRef: "p1",
  unknownPickupPointRef: "p9",
  waybill: {
    clientReference: "FK-000001",
    service: null,
    payer: "recipient",
    declaredValue: { amount: 10_000, currency: "UAH" },
    parcel: { weightGrams: 500, lengthMm: 100, widthMm: 100, heightMm: 100, seats: 1 },
    description: "Parcel",
    recipient: { firstName: "Test", lastName: "Person", phone: "+380000000000" },
    destination: { kind: "pickup_point", cityRef: "c1", pickupPointRef: "p1" },
    settings: {},
  },
  validSettings: { senderName: "A B" },
  invalidSettings: {},
  liveSignal: () => signal(false),
  abortedSignal: () => signal(true),
};

/** A small provider that keeps every rule; each spec breaks one. */
function goodProvider(): ShippingProviderPort {
  const waybills = new Map<string, { created: WaybillCreated; ref: string }>();
  const guard = (s: ProviderAbortSignal) => {
    s.throwIfAborted();
  };
  return {
    code: "contract_probe",
    capabilities: {
      pickupPoints: true,
      estimate: true,
      waybills: true,
      cancelWaybill: true,
      tracking: true,
      labels: true,
    },
    validateSettings: (settings) =>
      typeof settings.senderName === "string" ? [] : [{ path: "senderName", code: "required" }],
    searchCities: (input, s) => {
      guard(s);
      return Promise.resolve([{ ref: "c1", name: "Місто", region: null }].slice(0, input.limit));
    },
    listPickupPoints: (input, s) => {
      guard(s);
      return Promise.resolve(
        POINTS.filter(
          (point) => point.cityRef === input.cityRef && input.kinds.includes(point.kind),
        ),
      );
    },
    findPickupPoint: (input, s) => {
      guard(s);
      return Promise.resolve(POINTS.find((point) => point.ref === input.ref) ?? null);
    },
    estimate: (input, s) => {
      guard(s);
      return Promise.resolve(providerOk({ amount: 6_000, currency: input.declaredValue.currency }));
    },
    createWaybill: (input, s) => {
      guard(s);
      const created: WaybillCreated = {
        providerRef: "w1",
        trackingNumber: "20450000000001",
        carrierCost: { amount: 8_000, currency: input.declaredValue.currency },
        estimatedDeliveryDate: "2026-10-27",
      };
      waybills.set(created.providerRef, { created, ref: input.clientReference });
      return Promise.resolve(providerOk(created));
    },
    findWaybill: (input, s) => {
      guard(s);
      if (!(Date.parse(input.createdAfter) < Date.parse(input.createdBefore))) {
        return Promise.resolve(providerFailure("rejected", ["invalid_window"]));
      }
      const found = [...waybills.values()].find((entry) => entry.ref === input.clientReference);
      return Promise.resolve(providerOk(found?.created ?? null));
    },
    cancelWaybill: (_input, s) => {
      guard(s);
      return Promise.resolve(providerOk(undefined));
    },
    track: (input, s) => {
      guard(s);
      return Promise.resolve(
        providerOk(
          input.trackingNumbers.map((trackingNumber) => ({
            trackingNumber,
            status: "created" as const,
            carrierStatusCode: "1",
            carrierStatusAt: null,
          })),
        ),
      );
    },
    fetchLabel: (_input, s) => {
      guard(s);
      return Promise.resolve(
        providerOk({
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
          contentType: "application/pdf" as const,
        }),
      );
    },
    checkConnection: (s) => {
      guard(s);
      return Promise.resolve(providerOk(undefined));
    },
  };
}

describe("checkShippingProviderContract", () => {
  it("finds nothing wrong with a provider that keeps the rules", async () => {
    expect(await checkShippingProviderContract(goodProvider(), scenario)).toEqual([]);
  });

  it("accepts a typed label failure (labels are best effort)", async () => {
    const provider = goodProvider();
    provider.fetchLabel = () => Promise.resolve(providerFailure("unavailable", ["422"]));
    expect(await checkShippingProviderContract(provider, scenario)).toEqual([]);
  });

  it("reports each broken rule", async () => {
    const cases: [string, (provider: ShippingProviderPort) => void, RegExp][] = [
      [
        "settings accepted blindly",
        (p) => {
          p.validateSettings = () => [];
        },
        /refuse the invalid settings/,
      ],
      [
        "settings issue with text",
        (p) => {
          p.validateSettings = () => [{ path: "senderPhone", code: "The phone is wrong" }];
        },
        /valid settings|invalid settings/,
      ],
      [
        "point of another kind",
        (p) => {
          p.listPickupPoints = () => Promise.resolve(POINTS);
        },
        /kind that was not asked for/,
      ],
      [
        "unknown ref found",
        (p) => {
          p.findPickupPoint = () => Promise.resolve(POINTS[0] ?? null);
        },
        /point for an unknown ref/,
      ],
      [
        "estimate in another currency",
        (p) => {
          p.estimate = () => Promise.resolve(providerOk({ amount: 1, currency: "EUR" }));
        },
        /not money in the declared currency/,
      ],
      [
        "failure with message text",
        (p) => {
          p.estimate = () =>
            Promise.resolve({
              ok: false,
              reason: "rejected",
              providerCodes: ["Bad phone 0501234567"],
            });
        },
        /codes, not text/,
      ],
      [
        "inverted window found nothing",
        (p) => {
          p.findWaybill = () => Promise.resolve(providerOk(null));
        },
        /not two ordered instants|did not find the created waybill/,
      ],
      [
        "label not a pdf",
        (p) => {
          p.fetchLabel = () =>
            Promise.resolve(
              providerOk({
                bytes: new Uint8Array([1, 2, 3]),
                contentType: "application/pdf" as const,
              }),
            );
        },
        /not a PDF/,
      ],
      [
        "tracking message as code",
        (p) => {
          p.track = (input) =>
            Promise.resolve(
              providerOk(
                input.trackingNumbers.map((trackingNumber) => ({
                  trackingNumber,
                  status: null,
                  carrierStatusCode: "Ready to send",
                  carrierStatusAt: null,
                })),
              ),
            );
        },
        /track answered an update that breaks the port/,
      ],
      [
        "aborted signal ignored",
        (p) => {
          p.checkConnection = () => Promise.resolve(providerOk(undefined));
        },
        /checkConnection answered with an aborted signal/,
      ],
      [
        "capability not boolean",
        (p) => {
          (p as { capabilities: unknown }).capabilities = { ...p.capabilities, labels: "yes" };
        },
        /capability labels/,
      ],
    ];
    for (const [name, breakIt, expected] of cases) {
      const provider = goodProvider();
      breakIt(provider);
      const violations = await checkShippingProviderContract(provider, scenario);
      expect(violations.join("\n"), name).toMatch(expected);
    }
  });
});

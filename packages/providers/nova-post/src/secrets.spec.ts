import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { live, providerOn, VALID_SETTINGS, waybillRequest } from "./test-support/fixtures.js";
import {
  STUB_API_KEY,
  STUB_CITY_ID,
  STUB_PERSONAL,
  startStubCarrier,
  type StubCarrier,
} from "./test-support/stub-carrier.js";

/*
 * The key, the JWTs and personal data never reach a log line, a thrown message or a failure's codes, whatever the carrier
 * answers: the carrier's texts can echo them, so error texts are never kept (ADR 0029 decision 14, plan step 7b).
 */
describe("no secret or personal value in logs, errors or codes", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("holds for successes and for every kind of failure", async () => {
    const { provider, logger } = providerOn(stub);
    const seen: string[] = [];
    const record = (value: unknown) => {
      seen.push(JSON.stringify(value));
    };
    const capture = async (work: () => Promise<unknown>) => {
      try {
        record(await work());
      } catch (error) {
        record({ message: (error as Error).message, codes: (error as { codes?: unknown }).codes });
      }
    };
    const echo = `${STUB_API_KEY} ${STUB_PERSONAL.recipientPhoneNormalized} ${STUB_PERSONAL.senderName} ${STUB_PERSONAL.recipientLastName} shop@example.com`;

    // Successes first (a JWT is issued and used).
    await capture(() => provider.searchCities({ query: "Тест", locale: "uk", limit: 5 }, live()));
    await capture(() => provider.createWaybill(waybillRequest(), live()));
    const number = stub.shipments[0]?.number ?? "";
    await capture(() =>
      provider.track({ trackingNumbers: [number], phones: [STUB_PERSONAL.recipientPhone] }, live()),
    );

    // Then the carrier echoes everything back in its error texts, under every status.
    for (const status of [400, 401, 403, 404, 422, 429, 500, 503]) {
      const answer = {
        status,
        json: { errors: { errorMessage: echo, [echo.slice(0, 20)]: echo } },
      };
      for (const route of [
        "settlements",
        "divisions",
        "createShipment",
        "listShipments",
        "tracking",
        "print",
        "calculations",
        "deleteShipment",
      ] as const) {
        stub.override(route, () => answer);
      }
      await capture(() => provider.searchCities({ query: "Тест", locale: "uk", limit: 5 }, live()));
      await capture(() =>
        provider.listPickupPoints({ cityRef: String(STUB_CITY_ID), kinds: ["branch"] }, live()),
      );
      await capture(() => provider.findPickupPoint({ ref: "700001" }, live()));
      await capture(() =>
        provider.createWaybill(
          waybillRequest({ settings: { ...VALID_SETTINGS, senderEmail: "shop@example.com" } }),
          live(),
        ),
      );
      await capture(() =>
        provider.findWaybill(
          {
            clientReference: "FK-000123",
            createdAfter: "2026-01-01T00:00:00Z",
            createdBefore: "2027-01-01T00:00:00Z",
          },
          live(),
        ),
      );
      await capture(() =>
        provider.track(
          { trackingNumbers: [number], phones: [STUB_PERSONAL.recipientPhone] },
          live(),
        ),
      );
      await capture(() =>
        provider.fetchLabel({ providerRef: "x", trackingNumber: number, format: "pdf" }, live()),
      );
      await capture(() =>
        provider.cancelWaybill({ providerRef: "00000000-0000-4000-8000-000000000001" }, live()),
      );
      await capture(() =>
        provider.estimate(
          {
            service: null,
            destination: { kind: "pickup_point", cityRef: "1", pickupPointRef: "700002" },
            declaredValue: { amount: 1000, currency: "UAH" },
            parcel: null,
            settings: VALID_SETTINGS,
          },
          live(),
        ),
      );
    }
    // A refused key, too.
    stub.override("authorization", () => ({
      status: 422,
      json: { errors: { errorMessage: echo } },
    }));
    await capture(() => provider.checkConnection(live()));

    const everything = [...logger.lines, ...seen].join("\n");
    const forbidden = [
      STUB_API_KEY,
      ...stub.issued,
      STUB_PERSONAL.senderName,
      STUB_PERSONAL.senderPhone,
      STUB_PERSONAL.recipientFirstName,
      STUB_PERSONAL.recipientLastName,
      STUB_PERSONAL.recipientPhone,
      STUB_PERSONAL.recipientPhoneNormalized,
      "shop@example.com",
      "apiKey=",
      "127.0.0.1",
    ];
    for (const value of forbidden) {
      expect(everything, value).not.toContain(value);
    }
    expect(stub.issued.length).toBeGreaterThan(0);
    expect(logger.lines.length).toBeGreaterThan(10);
  });
});

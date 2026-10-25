import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SHIPPING_PROVIDER_METADATA,
  SHIPPING_CAPABILITIES,
  type WaybillRequest,
} from "@fluxkit/core";
import { FAKE_ESTIMATE_MINOR_UNITS, FakeShippingProvider, providerModule } from "./index.js";

const signal = new AbortController().signal;
const uah = (amount: number) => ({ amount, currency: "UAH" as const });
/** A window wide enough for any waybill these specs create. */
const window = {
  createdAfter: "2000-01-01T00:00:00.000Z",
  createdBefore: "2100-01-01T00:00:00.000Z",
};

function waybillRequest(clientReference: string, pickupPointRef: string): WaybillRequest {
  return {
    clientReference,
    service: null,
    payer: "recipient",
    declaredValue: uah(10_000),
    parcel: { weightGrams: 500, lengthMm: 100, widthMm: 100, heightMm: 100, seats: 1 },
    description: "Test parcel",
    recipient: { firstName: "Test", lastName: "Person", phone: "+380000000000" },
    destination: { kind: "pickup_point", cityRef: "fake-city-kyiv", pickupPointRef },
    settings: {},
  };
}

describe("FakeShippingProvider", () => {
  let fake: FakeShippingProvider;

  beforeEach(() => {
    fake = new FakeShippingProvider();
  });

  it("is a Nest provider marked for discovery with code fake and every capability", async () => {
    expect(Reflect.getMetadata(SHIPPING_PROVIDER_METADATA, FakeShippingProvider)).toEqual({
      code: "fake",
    });
    const moduleRef = await Test.createTestingModule({ imports: [providerModule] }).compile();
    const instance = moduleRef.get(FakeShippingProvider);
    expect(instance.code).toBe("fake");
    for (const capability of SHIPPING_CAPABILITIES) {
      expect(instance.capabilities[capability]).toBe(true);
    }
  });

  describe("lookups", () => {
    it("finds cities by name in either language, in the requested locale, within the limit", async () => {
      expect(await fake.searchCities({ query: "ки", locale: "uk", limit: 5 }, signal)).toEqual([
        { ref: "fake-city-kyiv", name: "Київ", region: "Київська" },
      ]);
      const english = await fake.searchCities({ query: "L", locale: "en", limit: 5 }, signal);
      expect(english.map((city) => city.name)).toEqual(["Lviv"]);
      expect(await fake.searchCities({ query: "", locale: "en", limit: 2 }, signal)).toHaveLength(
        2,
      );
      expect(await fake.searchCities({ query: "zzz", locale: "en", limit: 5 }, signal)).toEqual([]);
    });

    it("lists the same two points of a city every time, filtered by kind", async () => {
      const all = await fake.listPickupPoints(
        { cityRef: "fake-city-lviv", kinds: ["branch", "locker"] },
        signal,
      );
      expect(all.map((point) => [point.ref, point.kind])).toEqual([
        ["fake-city-lviv-point-1", "branch"],
        ["fake-city-lviv-point-2", "locker"],
      ]);
      expect(all).toEqual(
        await fake.listPickupPoints(
          { cityRef: "fake-city-lviv", kinds: ["branch", "locker"] },
          signal,
        ),
      );
      const lockers = await fake.listPickupPoints(
        { cityRef: "fake-city-lviv", kinds: ["locker"] },
        signal,
      );
      expect(lockers.map((point) => point.kind)).toEqual(["locker"]);
      expect(
        await fake.listPickupPoints({ cityRef: "nowhere", kinds: ["branch"] }, signal),
      ).toEqual([]);
    });

    it("finds one point by its ref, in Ukraine, and nothing for an unknown ref", async () => {
      const point = await fake.findPickupPoint({ ref: "fake-city-odesa-point-2" }, signal);
      expect(point).toMatchObject({
        ref: "fake-city-odesa-point-2",
        kind: "locker",
        cityRef: "fake-city-odesa",
        countryCode: "UA",
      });
      const listed = await fake.listPickupPoints(
        { cityRef: "fake-city-odesa", kinds: ["locker"] },
        signal,
      );
      expect(listed).toEqual([point]);
      expect(await fake.findPickupPoint({ ref: "nowhere" }, signal)).toBeNull();
    });

    it("throws when findPickupPoint is told to fail, as the port says lookups do", async () => {
      fake.failNext("findPickupPoint");
      await expect(
        fake.findPickupPoint({ ref: "fake-city-kyiv-point-1" }, signal),
      ).rejects.toThrow();
      expect(await fake.findPickupPoint({ ref: "fake-city-kyiv-point-1" }, signal)).not.toBeNull();
    });
  });

  describe("estimate", () => {
    it("quotes a fixed price in the currency of the declared value", async () => {
      const result = await fake.estimate(
        {
          service: null,
          destination: { kind: "city", cityRef: "fake-city-odesa" },
          declaredValue: { amount: 1, currency: "UAH" },
          parcel: null,
          settings: {},
        },
        signal,
      );
      expect(result).toEqual({ ok: true, value: uah(FAKE_ESTIMATE_MINOR_UNITS) });
    });

    it("rejects an unknown city with a carrier code, not a message", async () => {
      const result = await fake.estimate(
        {
          service: null,
          destination: { kind: "city", cityRef: "nowhere" },
          declaredValue: uah(1),
          parcel: null,
          settings: {},
        },
        signal,
      );
      expect(result).toMatchObject({
        ok: false,
        reason: "rejected",
        providerCodes: ["UNKNOWN_CITY"],
      });
    });
  });

  describe("waybills", () => {
    const point = "fake-city-kyiv-point-1";

    it("creates numbered waybills deterministically, finds them by client reference and tracks them", async () => {
      const first = await fake.createWaybill(waybillRequest("ORD-1", point), signal);
      const second = await fake.createWaybill(waybillRequest("ORD-2", point), signal);
      expect(first).toMatchObject({
        ok: true,
        value: { providerRef: "fake-waybill-000001", trackingNumber: "FAKE000001" },
      });
      expect(second).toMatchObject({ ok: true, value: { trackingNumber: "FAKE000002" } });
      expect(await fake.findWaybill({ clientReference: "ORD-2", ...window }, signal)).toMatchObject(
        {
          ok: true,
          value: { trackingNumber: "FAKE000002" },
        },
      );
      expect(await fake.findWaybill({ clientReference: "none", ...window }, signal)).toEqual({
        ok: true,
        value: null,
      });
      const tracked = await fake.track(
        { trackingNumbers: ["FAKE000001", "FAKE999999"], phones: [] },
        signal,
      );
      expect(tracked).toEqual({
        ok: true,
        value: [
          {
            trackingNumber: "FAKE000001",
            status: "created",
            carrierStatusCode: "FAKE_CREATED",
            carrierStatusAt: null,
          },
        ],
      });
    });

    it("findWaybill honours the window by instant, across a UTC midnight (review M-2)", async () => {
      fake.now = () => new Date("2026-10-25T00:00:10.000Z");
      await fake.createWaybill(waybillRequest("ORD-1", point), signal);
      // A window that starts on the day before still finds a waybill saved just after midnight.
      expect(
        await fake.findWaybill(
          {
            clientReference: "ORD-1",
            createdAfter: "2026-10-24T23:54:50.000Z",
            createdBefore: "2026-10-25T00:10:00.000Z",
          },
          signal,
        ),
      ).toMatchObject({ ok: true, value: { trackingNumber: "FAKE000001" } });
      // Outside the window on either side: not found.
      expect(
        await fake.findWaybill(
          {
            clientReference: "ORD-1",
            createdAfter: "2026-10-24T00:00:00.000Z",
            createdBefore: "2026-10-25T00:00:09.999Z",
          },
          signal,
        ),
      ).toEqual({ ok: true, value: null });
      expect(
        await fake.findWaybill(
          {
            clientReference: "ORD-1",
            createdAfter: "2026-10-25T00:00:10.001Z",
            createdBefore: "2026-10-26T00:00:00.000Z",
          },
          signal,
        ),
      ).toEqual({ ok: true, value: null });
      // A window that is not two ordered instants is a refusal, never "not found".
      expect(
        await fake.findWaybill(
          { clientReference: "ORD-1", createdAfter: "2026-10-25", createdBefore: "yesterday" },
          signal,
        ),
      ).toMatchObject({ ok: false, reason: "rejected", providerCodes: ["INVALID_WINDOW"] });
    });

    it("refuses a second waybill for one client reference and an unknown pickup point", async () => {
      await fake.createWaybill(waybillRequest("ORD-1", point), signal);
      expect(await fake.createWaybill(waybillRequest("ORD-1", point), signal)).toMatchObject({
        ok: false,
        providerCodes: ["DUPLICATE_REFERENCE"],
      });
      expect(await fake.createWaybill(waybillRequest("ORD-2", "nope"), signal)).toMatchObject({
        ok: false,
        providerCodes: ["UNKNOWN_POINT"],
      });
      expect(fake.waybillCount()).toBe(1);
    });

    it("cancels a created waybill once, and a cancelled waybill is no longer found", async () => {
      await fake.createWaybill(waybillRequest("ORD-1", point), signal);
      expect(await fake.cancelWaybill({ providerRef: "fake-waybill-000001" }, signal)).toEqual({
        ok: true,
        value: undefined,
      });
      expect(
        await fake.cancelWaybill({ providerRef: "fake-waybill-000001" }, signal),
      ).toMatchObject({
        ok: false,
        providerCodes: ["NOT_CANCELLABLE"],
      });
      expect(await fake.cancelWaybill({ providerRef: "ghost" }, signal)).toMatchObject({
        ok: false,
        providerCodes: ["UNKNOWN_WAYBILL"],
      });
      expect(await fake.findWaybill({ clientReference: "ORD-1", ...window }, signal)).toEqual({
        ok: true,
        value: null,
      });
    });

    it("tracks the status a test sets, and refuses to set one for an unknown waybill", async () => {
      await fake.createWaybill(waybillRequest("ORD-1", point), signal);
      fake.setTrackingStatus("FAKE000001", "delivered", "FAKE_DELIVERED");
      expect(
        await fake.track({ trackingNumbers: ["FAKE000001"], phones: [] }, signal),
      ).toMatchObject({
        ok: true,
        value: [{ status: "delivered", carrierStatusCode: "FAKE_DELIVERED" }],
      });
      expect(() => fake.setTrackingStatus("FAKE000009", "delivered", "X")).toThrow(RangeError);
      expect(
        await fake.cancelWaybill({ providerRef: "fake-waybill-000001" }, signal),
      ).toMatchObject({
        ok: false,
        providerCodes: ["NOT_CANCELLABLE"],
      });
    });

    it("returns a PDF label for a known waybill only", async () => {
      await fake.createWaybill(waybillRequest("ORD-1", point), signal);
      const label = await fake.fetchLabel(
        { providerRef: "fake-waybill-000001", format: "pdf" },
        signal,
      );
      expect(label.ok && label.value.contentType).toBe("application/pdf");
      expect(label.ok && new TextDecoder().decode(label.value.bytes).startsWith("%PDF-")).toBe(
        true,
      );
      expect(await fake.fetchLabel({ providerRef: "ghost", format: "pdf" }, signal)).toMatchObject({
        ok: false,
        providerCodes: ["UNKNOWN_WAYBILL"],
      });
    });

    it("reports a healthy connection", async () => {
      expect(await fake.checkConnection(signal)).toEqual({ ok: true, value: undefined });
    });
  });

  describe("failure hook", () => {
    it("fails the next call of a result operation with the given reason and codes, then recovers", async () => {
      fake.failNext("checkConnection", {
        reason: "invalid_credentials",
        providerCodes: ["BAD_KEY"],
      });
      expect(await fake.checkConnection(signal)).toEqual({
        ok: false,
        reason: "invalid_credentials",
        providerCodes: ["BAD_KEY"],
      });
      expect(await fake.checkConnection(signal)).toEqual({ ok: true, value: undefined });
    });

    it("defaults to unavailable and honours times", async () => {
      fake.failNext("checkConnection", { times: 2 });
      expect(await fake.checkConnection(signal)).toMatchObject({
        ok: false,
        reason: "unavailable",
      });
      expect(await fake.checkConnection(signal)).toMatchObject({
        ok: false,
        reason: "unavailable",
      });
      expect(await fake.checkConnection(signal)).toMatchObject({ ok: true });
    });

    it("makes a directory lookup throw, as the port says lookups do", async () => {
      fake.failNext("searchCities");
      await expect(
        fake.searchCities({ query: "k", locale: "en", limit: 1 }, signal),
      ).rejects.toThrow(/searchCities failed on request/);
      expect(await fake.searchCities({ query: "k", locale: "en", limit: 1 }, signal)).toHaveLength(
        1,
      );
    });

    it("afterEffect creates the waybill but loses the answer, so findWaybill can settle it", async () => {
      fake.failNext("createWaybill", { afterEffect: true });
      const lost = await fake.createWaybill(
        waybillRequest("ORD-1", "fake-city-kyiv-point-1"),
        signal,
      );
      expect(lost).toMatchObject({ ok: false, reason: "unavailable" });
      expect(fake.waybillCount()).toBe(1);
      expect(await fake.findWaybill({ clientReference: "ORD-1", ...window }, signal)).toMatchObject(
        {
          ok: true,
          value: { trackingNumber: "FAKE000001" },
        },
      );
    });

    it("a plain createWaybill failure creates nothing", async () => {
      fake.failNext("createWaybill", { reason: "rejected", providerCodes: ["X1"] });
      expect(
        await fake.createWaybill(waybillRequest("ORD-1", "fake-city-kyiv-point-1"), signal),
      ).toMatchObject({
        ok: false,
        reason: "rejected",
      });
      expect(fake.waybillCount()).toBe(0);
    });

    it("hang never answers until the signal aborts", async () => {
      const controller = new AbortController();
      fake.failNext("checkConnection", { hang: true });
      const pending = fake.checkConnection(controller.signal);
      let settled = false;
      void pending.then(
        () => (settled = true),
        () => (settled = true),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      controller.abort(new Error("timeout"));
      await expect(pending).rejects.toThrow("timeout");
    });

    it("an already aborted signal rejects before any work", async () => {
      const controller = new AbortController();
      controller.abort(new Error("gone"));
      await expect(fake.checkConnection(controller.signal)).rejects.toThrow("gone");
    });

    it("rejects an unknown operation or a bad count, and reset clears plans and waybills", async () => {
      expect(() => fake.failNext("nope" as never)).toThrow(RangeError);
      expect(() => fake.failNext("track", { times: 0 })).toThrow(RangeError);
      await fake.createWaybill(waybillRequest("ORD-1", "fake-city-kyiv-point-1"), signal);
      fake.failNext("checkConnection");
      fake.reset();
      expect(fake.waybillCount()).toBe(0);
      expect(await fake.checkConnection(signal)).toMatchObject({ ok: true });
      const again = await fake.createWaybill(
        waybillRequest("ORD-1", "fake-city-kyiv-point-1"),
        signal,
      );
      expect(again).toMatchObject({ ok: true, value: { trackingNumber: "FAKE000001" } });
    });
  });
});

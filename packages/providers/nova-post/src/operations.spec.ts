import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHIPPING_PROVIDER_TIMEOUTS_MS } from "@fluxkit/core";
import {
  NOVA_POST_LIST_DEADLINE_MS,
  NOVA_POST_LIST_MAX_PAGES,
  NOVA_POST_LIST_PARALLEL_PAGES,
  NOVA_POST_LIST_STOP_MS,
  novaPostPhone,
} from "./nova-post-provider.js";
import { live, providerOn, VALID_SETTINGS, waybillRequest } from "./test-support/fixtures.js";
import {
  STUB_CITY_ID,
  startStubCarrier,
  stubDivisions,
  type RecordedRequest,
  type StubCarrier,
} from "./test-support/stub-carrier.js";

async function created(stub: StubCarrier) {
  const { provider } = providerOn(stub);
  const result = await provider.createWaybill(waybillRequest(), live());
  if (!result.ok) throw new Error("create failed");
  return { provider, waybill: result.value };
}

describe("Nova Post operations", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
  });

  afterEach(async () => {
    await stub.close();
  });

  describe("cancelWaybill", () => {
    it("treats a repeat (422 shipment_was_deleted, H29) as done and an unknown id as rejected", async () => {
      const { provider, waybill } = await created(stub);
      const cancel = () => provider.cancelWaybill({ providerRef: waybill.providerRef }, live());
      expect(await cancel()).toEqual({ ok: true, value: undefined });
      expect(await cancel()).toEqual({ ok: true, value: undefined });
      expect(
        await provider.cancelWaybill(
          { providerRef: "00000000-0000-4000-8000-999999999999" },
          live(),
        ),
      ).toEqual({
        ok: false,
        reason: "rejected",
        providerCodes: ["404", "errorMessage", "shipment_not_found"],
      });
    });

    it("refuses a ref that is not a shipment uuid without a call (Ukraine deletes by id only, H28)", async () => {
      const { provider, waybill } = await created(stub);
      for (const ref of [waybill.trackingNumber, "../clients", "x"]) {
        expect(await provider.cancelWaybill({ providerRef: ref }, live())).toEqual({
          ok: false,
          reason: "rejected",
          providerCodes: ["invalid_reference"],
        });
      }
      expect(stub.of("deleteShipment")).toHaveLength(0);
    });

    it("answers a refusal of a delete as rejected (a parcel already on its way)", async () => {
      const { provider, waybill } = await created(stub);
      stub.override("deleteShipment", () => ({
        status: 422,
        json: { errors: { errorMessage: "deletion not allowed" } },
      }));
      expect(await provider.cancelWaybill({ providerRef: waybill.providerRef }, live())).toEqual({
        ok: false,
        reason: "rejected",
        providerCodes: ["422", "errorMessage"],
      });
    });
  });

  describe("track", () => {
    it("maps codes through the table and keeps the raw code (number or string in the answer)", async () => {
      const { provider, waybill } = await created(stub);
      const shipment = stub.shipments[0];
      if (shipment === undefined) throw new Error("no shipment");
      for (const [code, status] of [
        [1, "created"],
        [5, "in_transit"],
        [8, "arrived"],
        [9, "delivered"],
        [103, "returning"],
        [2, "cancelled"],
        [999, null],
      ] as const) {
        shipment.statusCode = code;
        const result = await provider.track(
          { trackingNumbers: [waybill.trackingNumber], phones: [] },
          live(),
        );
        expect(result, String(code)).toMatchObject({
          ok: true,
          value: [{ status, carrierStatusCode: String(code) }],
        });
      }
    });

    it("reads the documented shape too and answers an empty list for unknown numbers (404)", async () => {
      const { provider, waybill } = await created(stub);
      stub.override("tracking", () => ({
        status: 200,
        json: {
          currentStatus: [
            { number: waybill.trackingNumber, statusCode: "7", statusDate: "2026-10-26T08:00:00Z" },
            { number: "20459999999999", statusCode: "9" },
          ],
        },
      }));
      expect(
        await provider.track({ trackingNumbers: [waybill.trackingNumber], phones: [] }, live()),
      ).toEqual({
        ok: true,
        value: [
          {
            trackingNumber: waybill.trackingNumber,
            status: "arrived",
            carrierStatusCode: "7",
            carrierStatusAt: new Date("2026-10-26T08:00:00Z"),
          },
        ],
      });
      stub.override("tracking", undefined);
      expect(
        await provider.track({ trackingNumbers: ["20450000000099"], phones: [] }, live()),
      ).toEqual({ ok: true, value: [] });
      const calls = stub.of("tracking").length;
      expect(await provider.track({ trackingNumbers: ["FAKE01"], phones: [] }, live())).toEqual({
        ok: true,
        value: [],
      });
      expect(stub.of("tracking")).toHaveLength(calls);
    });
  });

  describe("fetchLabel (best effort, never a made-up PDF)", () => {
    it("answers production's 422 'Internal Server Error' as unavailable and a 404 as rejected", async () => {
      const { provider, waybill } = await created(stub);
      const label = () =>
        provider.fetchLabel(
          {
            providerRef: waybill.providerRef,
            trackingNumber: waybill.trackingNumber,
            format: "pdf",
          },
          live(),
        );
      stub.override("print", () => ({
        status: 422,
        json: { errors: { errorMessage: "Internal Server Error" } },
      }));
      expect(await label()).toEqual({
        ok: false,
        reason: "unavailable",
        providerCodes: ["422", "errorMessage"],
      });
      stub.override("print", () => ({
        status: 404,
        json: { errors: { errorMessage: "shipments not found" } },
      }));
      expect(await label()).toEqual({
        ok: false,
        reason: "rejected",
        providerCodes: ["404", "errorMessage"],
      });
      for (const answer of [
        { status: 200, json: { url: "https://example.invalid/label.pdf" } },
        { status: 200, body: "<html></html>", headers: { "content-type": "application/pdf" } },
      ]) {
        stub.override("print", () => answer);
        expect(await label()).toEqual({
          ok: false,
          reason: "unavailable",
          providerCodes: ["not_pdf"],
        });
      }
    });

    it("answers a 422 that names a field of our request as rejected (a broken request shape; review R5)", async () => {
      const { provider, waybill } = await created(stub);
      stub.override("print", () => ({
        status: 422,
        json: { errors: { type: "The type field must be a string." } },
      }));
      expect(
        await provider.fetchLabel(
          {
            providerRef: waybill.providerRef,
            trackingNumber: waybill.trackingNumber,
            format: "pdf",
          },
          live(),
        ),
      ).toEqual({ ok: false, reason: "rejected", providerCodes: ["422", "type"] });
    });

    it("refuses a number that is not one without a call", async () => {
      const { provider } = providerOn(stub);
      expect(
        await provider.fetchLabel(
          { providerRef: "x", trackingNumber: "1&type[]=x", format: "pdf" },
          live(),
        ),
      ).toEqual({ ok: false, reason: "rejected", providerCodes: ["invalid_number"] });
      expect(stub.of("print")).toHaveLength(0);
    });
  });

  describe("createWaybill and estimate refuse what they cannot send", () => {
    it("answers without a call for incomplete settings, an address, another currency, a bad phone or name", async () => {
      const { provider } = providerOn(stub);
      const cases: [Parameters<typeof waybillRequest>[0], string, string][] = [
        [{ settings: {} }, "rejected", "settings_invalid"],
        [
          {
            destination: {
              kind: "address",
              address: { countryCode: "UA", city: "Київ", line1: "вул. Вигадана, 1" },
            },
          },
          "not_supported",
          "destination_kind",
        ],
        [{ declaredValue: { amount: 1000, currency: "EUR" } }, "not_supported", "currency"],
        [
          { destination: { kind: "pickup_point", cityRef: "1", pickupPointRef: "abc" } },
          "rejected",
          "invalid_pickup_point",
        ],
        [
          { recipient: { firstName: "Тест", lastName: "Отримувач", phone: "+44 20 0000 0000" } },
          "rejected",
          "recipient_phone",
        ],
        [
          { recipient: { firstName: " ", lastName: " ", phone: "0500000002" } },
          "rejected",
          "recipient_name",
        ],
      ];
      for (const [overrides, reason, code] of cases) {
        expect(await provider.createWaybill(waybillRequest(overrides), live()), code).toEqual({
          ok: false,
          reason,
          providerCodes: [code],
        });
      }
      expect(stub.of("createShipment")).toHaveLength(0);
      const estimate = (overrides: Record<string, unknown>) =>
        provider.estimate(
          {
            service: null,
            destination: { kind: "pickup_point", cityRef: "1", pickupPointRef: "700002" },
            declaredValue: { amount: 1000, currency: "UAH" },
            parcel: null,
            settings: VALID_SETTINGS,
            ...overrides,
          },
          live(),
        );
      expect(await estimate({ destination: { kind: "city", cityRef: "1" } })).toMatchObject({
        reason: "not_supported",
      });
      expect(await estimate({ declaredValue: { amount: 1, currency: "PLN" } })).toMatchObject({
        reason: "not_supported",
      });
      expect(await estimate({ settings: {} })).toMatchObject({
        reason: "rejected",
        providerCodes: ["settings_invalid"],
      });
      expect(stub.of("calculations")).toHaveLength(0);
    });

    it("refuses a recipient name of one word without a call (the carrier wants two words, H18)", async () => {
      const { provider } = providerOn(stub);
      for (const recipient of [
        { firstName: "Ярина", lastName: " ", phone: "0500000002" },
        { firstName: " ", lastName: "Вигаданенко", phone: "0500000002" },
      ]) {
        expect(await provider.createWaybill(waybillRequest({ recipient }), live())).toEqual({
          ok: false,
          reason: "rejected",
          providerCodes: ["recipient_name"],
        });
      }
      expect(stub.of("createShipment")).toHaveLength(0);
    });

    it("answers a create's 422 that names no field as unavailable (a server error dressed as 422; review R2)", async () => {
      const { provider } = providerOn(stub);
      stub.override("createShipment", () => ({
        status: 422,
        json: { errors: { errorMessage: "Internal Server Error" } },
      }));
      // `unavailable`: the shipment may exist, so the API makes it `unknown` and reconciles; never `failed`.
      expect(await provider.createWaybill(waybillRequest(), live())).toEqual({
        ok: false,
        reason: "unavailable",
        providerCodes: ["422", "errorMessage"],
      });
      stub.override("createShipment", () => ({ status: 422, body: "" }));
      expect(await provider.createWaybill(waybillRequest(), live())).toMatchObject({
        ok: false,
        reason: "unavailable",
      });
      // A 422 naming a field of our request stays a refusal.
      stub.override("createShipment", () => ({
        status: 422,
        json: { errors: { "recipient.phone": "The recipient.phone format is invalid." } },
      }));
      expect(await provider.createWaybill(waybillRequest(), live())).toEqual({
        ok: false,
        reason: "rejected",
        providerCodes: ["422", "recipient.phone"],
      });
      expect(stub.of("createShipment")).toHaveLength(3);
    });

    it("refuses a carrier amount with more than two decimals instead of rounding it", async () => {
      const { provider } = providerOn(stub);
      stub.override("calculations", () => ({
        status: 200,
        json: { services: [{ cost: 80.125 }] },
      }));
      expect(
        await provider.estimate(
          {
            service: null,
            destination: { kind: "pickup_point", cityRef: "1", pickupPointRef: "700002" },
            declaredValue: { amount: 1000, currency: "UAH" },
            parcel: null,
            settings: VALID_SETTINGS,
          },
          live(),
        ),
      ).toEqual({ ok: false, reason: "rejected", providerCodes: ["invalid_amount"] });
      // The create's cost the same way: the waybill is kept, its cost is not.
      stub.override("createShipment", (request) => {
        const body = request.body as { clientOrder: string };
        const stored = stub.addShipment({
          clientOrder: body.clientOrder,
          createdAt: new Date().toISOString(),
        });
        return { status: 201, json: { id: stored.id, number: stored.number, cost: -5 } };
      });
      expect(await provider.createWaybill(waybillRequest(), live())).toMatchObject({
        ok: true,
        value: { carrierCost: null, estimatedDeliveryDate: null },
      });
    });

    it("normalizes Ukrainian phones to 380XXXXXXXXX", () => {
      expect(novaPostPhone("+380 50 000 00 02")).toBe("380500000002");
      expect(novaPostPhone("050-000-00-02")).toBe("380500000002");
      expect(novaPostPhone("(050) 0000002")).toBe("380500000002");
      expect(novaPostPhone("380500000002")).toBe("380500000002");
      for (const bad of ["+48 500 000 000", "50000002", "3805000000021", "phone"]) {
        expect(novaPostPhone(bad), bad).toBeUndefined();
      }
    });
  });

  describe("listPickupPoints in a big city", () => {
    it(`reads branches first and at most ${String(NOVA_POST_LIST_MAX_PAGES)} pages, ${String(NOVA_POST_LIST_PARALLEL_PAGES)} at a time, and logs the cut`, async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      stub.override("divisions", (request) => {
        const category = request.query.getAll("divisionCategories[]")[0] ?? "";
        const page = Number(request.query.get("page"));
        const lastPage = category === "Postomat" ? 74 : 5;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
        }, 20);
        const kindBase = category === "Postomat" ? 2_000_000 : 1_000_000;
        return {
          status: 200,
          delayMs: 20,
          json: {
            current_page: page,
            last_page: lastPage,
            total: lastPage * 100,
            items: Array.from({ length: 100 }, (_, i) => ({
              id: kindBase + page * 1000 + i,
              number: `1/${String(page * 1000 + i)}`,
              name: "Пункт",
              address: "вул. Вигадана",
              divisionCategory: category === "Postomat" ? "Postomat" : "PostBranch",
              countryCode: "UA",
              settlement: { id: STUB_CITY_ID, name: "Тестове Місто" },
            })),
          },
        };
      });
      const { provider, logger } = providerOn(stub);
      const points = await provider.listPickupPoints(
        { cityRef: String(STUB_CITY_ID), kinds: ["branch", "locker"] },
        live(),
      );
      expect(stub.of("divisions")).toHaveLength(NOVA_POST_LIST_MAX_PAGES);
      expect(points.filter((point) => point.kind === "branch")).toHaveLength(500);
      expect(points.filter((point) => point.kind === "locker")).toHaveLength(1000);
      expect(maxInFlight).toBeLessThanOrEqual(NOVA_POST_LIST_PARALLEL_PAGES);
      expect(logger.lines.join("\n")).toMatch(
        /listPickupPoints: a city lists \d+ points; kept 1500/,
      );
    });

    /** Kyiv-sized answers (5 branch pages, 74 locker pages of 100; spike 7a rerun H12) with no delay of their own. */
    const kyivSized = (request: RecordedRequest) => {
      const category = request.query.getAll("divisionCategories[]")[0] ?? "";
      const page = Number(request.query.get("page"));
      const lastPage = category === "Postomat" ? 74 : 5;
      const kindBase = category === "Postomat" ? 2_000_000 : 1_000_000;
      return {
        status: 200,
        json: {
          current_page: page,
          last_page: lastPage,
          total: lastPage * 100,
          items: Array.from({ length: 100 }, (_, i) => ({
            id: kindBase + page * 1000 + i,
            number: `1/${String(page * 1000 + i)}`,
            name: "Пункт",
            address: "вул. Вигадана",
            divisionCategory: category === "Postomat" ? "Postomat" : "PostBranch",
            countryCode: "UA",
            settlement: { id: STUB_CITY_ID, name: "Тестове Місто" },
          })),
        },
      };
    };

    it("keeps its own time budget below the API's lookup limit", () => {
      expect(NOVA_POST_LIST_DEADLINE_MS).toBeLessThan(NOVA_POST_LIST_STOP_MS);
      expect(NOVA_POST_LIST_STOP_MS).toBeLessThan(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup);
    });

    it("reads the whole page budget of a Kyiv-sized city at 400 ms a call, JWT on a cold cache included (review R7)", async () => {
      stub.latencyMs = 400;
      const arrivals: [string, number][] = [];
      stub.override("divisions", (request) => {
        arrivals.push([
          `${request.query.getAll("divisionCategories[]")[0] ?? ""}:${request.query.get("page") ?? ""}`,
          performance.now(),
        ]);
        return kyivSized(request);
      });
      const { provider } = providerOn(stub);
      const started = performance.now();
      const points = await provider.listPickupPoints(
        { cityRef: String(STUB_CITY_ID), kinds: ["branch", "locker"] },
        AbortSignal.timeout(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup),
      );
      expect(points).toHaveLength(1500);
      expect(performance.now() - started).toBeLessThan(NOVA_POST_LIST_DEADLINE_MS);
      // The first branch and locker pages are asked for together, not one after the other.
      const firstPages = new Map(arrivals.slice(0, 2));
      expect([...firstPages.keys()].sort()).toEqual(["PostBranch:1", "Postomat:1"]);
      const [branchAt, lockerAt] = [firstPages.get("PostBranch:1"), firstPages.get("Postomat:1")];
      expect(Math.abs((branchAt ?? 0) - (lockerAt ?? Infinity))).toBeLessThan(200);
    }, 10_000);

    it("answers what it read at 850 ms a call instead of losing every point to the API's limit (review R7)", async () => {
      stub.latencyMs = 850;
      const arrivals: number[] = [];
      stub.override("divisions", (request) => {
        arrivals.push(performance.now());
        return kyivSized(request);
      });
      const { provider, logger } = providerOn(stub);
      const started = performance.now();
      const points = await provider.listPickupPoints(
        { cityRef: String(STUB_CITY_ID), kinds: ["branch", "locker"] },
        AbortSignal.timeout(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup),
      );
      expect(performance.now() - started).toBeLessThan(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup);
      expect(points.filter((point) => point.kind === "branch")).toHaveLength(500);
      expect(points.filter((point) => point.kind === "locker").length).toBeGreaterThanOrEqual(100);
      expect(points.length).toBeLessThan(1500);
      expect(logger.lines.join("\n")).toMatch(
        /listPickupPoints: a city lists 7900 points; kept \d+ \(time budget 3500 ms\)/,
      );
      // No page is started after the deadline (a little slack for the way to the stub).
      for (const at of arrivals) {
        expect(at - started).toBeLessThan(NOVA_POST_LIST_DEADLINE_MS + 200);
      }
    }, 10_000);

    it("abandons pages still in flight at its stop and answers the pages it has", async () => {
      stub.override("divisions", (request) =>
        request.query.get("page") === "1" ? kyivSized(request) : { status: 200, hang: true },
      );
      const { provider, logger } = providerOn(stub);
      const started = performance.now();
      const points = await provider.listPickupPoints(
        { cityRef: String(STUB_CITY_ID), kinds: ["branch", "locker"] },
        AbortSignal.timeout(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup),
      );
      expect(performance.now() - started).toBeLessThan(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup);
      expect(points).toHaveLength(200);
      expect(logger.lines.join("\n")).toMatch(/kept 200 \(time budget 3500 ms\)/);
    }, 10_000);

    it("drops a division of another settlement that the answer carries (the filter ignored)", async () => {
      stub.override("divisions", (request) => {
        if (request.query.getAll("divisionCategories[]")[0] !== "PostBranch") return undefined;
        const own = stubDivisions().filter((entry) => entry.id === 700001);
        const foreign = {
          ...own[0],
          id: 799999,
          settlement: { id: STUB_CITY_ID + 5, name: "Інше Місто" },
        };
        return {
          status: 200,
          json: { current_page: 1, last_page: 1, total: 2, items: [...own, foreign] },
        };
      });
      const { provider, logger } = providerOn(stub);
      const points = await provider.listPickupPoints(
        { cityRef: String(STUB_CITY_ID), kinds: ["branch"] },
        live(),
      );
      expect(points.map((point) => point.ref)).toEqual(["700001"]);
      expect(logger.lines.join("\n")).toMatch(/1 answer entries break the expected shape/);
    });

    it("throws when a page fails (lookups throw; the API serves its stale cache)", async () => {
      stub.override("divisions", (request) =>
        request.query.get("page") === "1"
          ? {
              status: 200,
              json: {
                current_page: 1,
                last_page: 2,
                total: 200,
                items: [],
              },
            }
          : { status: 503, body: "reset", headers: { "content-type": "text/plain" } },
      );
      const { provider } = providerOn(stub);
      await expect(
        provider.listPickupPoints({ cityRef: String(STUB_CITY_ID), kinds: ["branch"] }, live()),
      ).rejects.toMatchObject({ reason: "unavailable", codes: ["503"] });
    });
  });
});

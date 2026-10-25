import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NOVA_POST_FIND_MAX_PAGES } from "./nova-post-provider.js";
import { live, providerOn } from "./test-support/fixtures.js";
import { startStubCarrier, type StubCarrier } from "./test-support/stub-carrier.js";

/*
 * findWaybill pages GET /shipments (no reference or date filter exists; newest first, H23) and matches `clientOrder` and
 * `createdAt` inside the instant window of review M-2. `null` must mean "not there"; a scan that cannot be sure is a
 * failure, never `null`, because the API turns `null` into `failed` and a create may follow (a duplicate shipment).
 */

const T = Date.parse("2026-10-25T21:40:00.000Z");
const at = (offsetMinutes: number) => new Date(T + offsetMinutes * 60_000).toISOString();
const window = { createdAfter: at(-5), createdBefore: at(30) };

describe("findWaybill", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("finds our shipment on page 2 behind newer ones", async () => {
    const ours = stub.addShipment({ clientOrder: "FK-000123", createdAt: at(0) });
    for (let i = 1; i <= 120; i += 1) {
      stub.addShipment({ clientOrder: `OTHER-${String(i)}`, createdAt: at(i / 10) });
    }
    const { provider } = providerOn(stub);
    const result = await provider.findWaybill({ clientReference: "FK-000123", ...window }, live());
    expect(result).toEqual({
      ok: true,
      value: {
        providerRef: ours.id,
        trackingNumber: ours.number,
        carrierCost: { amount: 8000, currency: "UAH" },
        estimatedDeliveryDate: "2026-10-27",
      },
    });
    expect(stub.of("listShipments").map((r) => r.rawQuery)).toEqual([
      "limit=100&page=1",
      "limit=100&page=2",
    ]);
  });

  it("honours the window on both sides: the same reference outside it is not ours", async () => {
    stub.addShipment({ clientOrder: "FK-000123", createdAt: at(-6) });
    stub.addShipment({ clientOrder: "FK-000123", createdAt: at(31) });
    const { provider } = providerOn(stub);
    expect(await provider.findWaybill({ clientReference: "FK-000123", ...window }, live())).toEqual(
      { ok: true, value: null },
    );
    // At the edges (inclusive) it is ours.
    const edge = stub.addShipment({ clientOrder: "FK-000777", createdAt: at(-5) });
    expect(
      await provider.findWaybill({ clientReference: "FK-000777", ...window }, live()),
    ).toMatchObject({ ok: true, value: { providerRef: edge.id } });
  });

  it("stops early once a newest-first page is older than the window, and answers null with certainty", async () => {
    for (let i = 1; i <= 250; i += 1) {
      stub.addShipment({ clientOrder: `OLD-${String(i)}`, createdAt: at(-10 - i) });
    }
    const { provider } = providerOn(stub);
    expect(await provider.findWaybill({ clientReference: "FK-000123", ...window }, live())).toEqual(
      { ok: true, value: null },
    );
    expect(stub.of("listShipments")).toHaveLength(1);
  });

  it("does not stop early on a page that is not sorted newest first", async () => {
    stub.addShipment({ clientOrder: "FK-000123", createdAt: at(1) });
    for (let i = 1; i <= 150; i += 1) {
      stub.addShipment({ clientOrder: `OLD-${String(i)}`, createdAt: at(-10 - i) });
    }
    // Page 1 answered in the wrong order (oldest first): the scan must go on to the end.
    stub.override("listShipments", (request) => {
      if (request.query.get("page") !== "1") return undefined;
      const rows = [...stub.shipments].reverse().slice(0, 100);
      return {
        status: 200,
        json: {
          current_page: 1,
          last_page: 2,
          total: 151,
          items: rows.map((row) => ({
            id: row.id,
            number: row.number,
            clientOrder: row.clientOrder,
            createdAt: row.createdAt,
          })),
        },
      };
    });
    const { provider } = providerOn(stub);
    const result = await provider.findWaybill({ clientReference: "FK-000123", ...window }, live());
    expect(result).toMatchObject({ ok: true });
    expect(stub.of("listShipments")).toHaveLength(2);
  });

  it(`gives up after ${String(NOVA_POST_FIND_MAX_PAGES)} pages with a failure, never null`, async () => {
    for (let i = 1; i <= NOVA_POST_FIND_MAX_PAGES * 100 + 50; i += 1) {
      stub.addShipment({ clientOrder: `BUSY-${String(i)}`, createdAt: at(29 - i / 1000) });
    }
    const { provider } = providerOn(stub);
    expect(await provider.findWaybill({ clientReference: "FK-000123", ...window }, live())).toEqual(
      { ok: false, reason: "unavailable", providerCodes: ["scan_limit"] },
    );
    expect(stub.of("listShipments")).toHaveLength(NOVA_POST_FIND_MAX_PAGES);
  });

  it("refuses to choose between two shipments with our reference (a repeated create, H22)", async () => {
    stub.addShipment({ clientOrder: "FK-000123", createdAt: at(0) });
    stub.addShipment({ clientOrder: "FK-000123", createdAt: at(1) });
    const { provider } = providerOn(stub);
    expect(await provider.findWaybill({ clientReference: "FK-000123", ...window }, live())).toEqual(
      { ok: false, reason: "rejected", providerCodes: ["ambiguous_reference"] },
    );
  });

  it("refuses a window that is not two ordered instants, without a call", async () => {
    const { provider } = providerOn(stub);
    for (const bad of [
      { createdAfter: at(5), createdBefore: at(0) },
      { createdAfter: at(0), createdBefore: at(0) },
      { createdAfter: "2026-10-25", createdBefore: "yesterday" },
    ]) {
      expect(await provider.findWaybill({ clientReference: "FK-000123", ...bad }, live())).toEqual({
        ok: false,
        reason: "rejected",
        providerCodes: ["invalid_window"],
      });
    }
    expect(stub.of("listShipments")).toHaveLength(0);
  });

  it("is not sure when a row is unreadable or a page fails: a failure, never null", async () => {
    stub.addShipment({ clientOrder: "FK-000999", createdAt: at(0) });
    const { provider } = providerOn(stub);
    stub.override("listShipments", () => ({
      status: 200,
      json: {
        current_page: 1,
        last_page: 1,
        total: 1,
        items: [{ id: "x", number: "2045", createdAt: "not a date" }],
      },
    }));
    expect(await provider.findWaybill({ clientReference: "FK-000123", ...window }, live())).toEqual(
      { ok: false, reason: "unavailable", providerCodes: ["malformed_answer"] },
    );
    stub.override("listShipments", () => ({
      status: 503,
      body: "upstream reset",
      headers: { "content-type": "text/plain" },
    }));
    expect(await provider.findWaybill({ clientReference: "FK-000123", ...window }, live())).toEqual(
      { ok: false, reason: "unavailable", providerCodes: ["503"] },
    );
  });

  it("does not find a deleted shipment (the list drops it, as on production)", async () => {
    const { provider } = providerOn(stub);
    const ours = stub.addShipment({ clientOrder: "FK-000123", createdAt: at(0) });
    ours.deleted = true;
    expect(await provider.findWaybill({ clientReference: "FK-000123", ...window }, live())).toEqual(
      { ok: true, value: null },
    );
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORDER_NUMBER_PATTERN } from "@fluxkit/core";
import { live, providerOn, VALID_SETTINGS, waybillRequest } from "./test-support/fixtures.js";
import {
  STUB_API_KEY,
  STUB_CITY_ID,
  STUB_PERSONAL,
  STUB_SENDER_DIVISION_ID,
  startStubCarrier,
  stubDivisions,
  type StubCarrier,
} from "./test-support/stub-carrier.js";

/*
 * The requests equal the shapes verified on production by spike 7a (scripts/spikes/nova-post-verify.mjs): array
 * parameters as `name[]` built by URLSearchParams, the raw JWT in `Authorization` (Bearer is 401, H04), `type=marking`
 * (not `type[]`), delete by the shipment's uuid, the inline create body.
 */
describe("Nova Post request shapes (the spike's verified forms)", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("exchanges the key for a JWT once and then sends the RAW JWT, never Bearer", async () => {
    const { provider } = providerOn(stub);
    await provider.searchCities({ query: "Тест", locale: "uk", limit: 5 }, live());
    await provider.searchCities({ query: "Test", locale: "en", limit: 5 }, live());
    const [authorization] = stub.of("authorization");
    expect(stub.of("authorization")).toHaveLength(1);
    expect(authorization?.rawQuery).toBe(`apiKey=${STUB_API_KEY}`);
    expect(authorization?.headers.authorization).toBeUndefined();
    const jwt = stub.issued[0];
    for (const request of stub.of("settlements")) {
      expect(request.headers.authorization).toBe(jwt);
      expect(String(request.headers.authorization)).not.toMatch(/^Bearer /i);
      // The key never leaves the authorization call.
      expect(request.rawQuery).not.toContain(STUB_API_KEY);
    }
  });

  it("searches settlements in Ukraine with Accept-language (H11: without it names are Latin)", async () => {
    const { provider } = providerOn(stub);
    const uk = await provider.searchCities({ query: "Тест", locale: "uk-UA", limit: 5 }, live());
    const en = await provider.searchCities({ query: "Test", locale: "en", limit: 500 }, live());
    const [first, second] = stub.of("settlements");
    expect(first?.rawQuery).toBe(
      `countryCodes%5B%5D=UA&textSearch=${encodeURIComponent("Тест")}&limit=5`,
    );
    expect(first?.headers["accept-language"]).toBe("uk");
    expect(second?.headers["accept-language"]).toBe("en");
    // Settlements refuse a limit over 100 (H15).
    expect(second?.query.get("limit")).toBe("100");
    expect(uk[0]).toEqual({
      ref: String(STUB_CITY_ID),
      name: "Тестове Місто",
      region: "Тестовий район, Тестова область",
    });
    expect(en[0]?.name).toBe("Testove Misto");
  });

  it("lists divisions of a settlement by category, branches first, 100 a page, in Ukrainian", async () => {
    const { provider } = providerOn(stub);
    const points = await provider.listPickupPoints(
      { cityRef: String(STUB_CITY_ID), kinds: ["branch", "locker"] },
      live(),
    );
    const [branches, lockers] = stub.of("divisions");
    expect(branches?.rawQuery).toBe(
      `countryCodes%5B%5D=UA&settlementIds%5B%5D=${String(STUB_CITY_ID)}&divisionCategories%5B%5D=PostBranch&divisionCategories%5B%5D=CargoBranch&limit=100&page=1`,
    );
    expect(lockers?.query.getAll("divisionCategories[]")).toEqual(["Postomat"]);
    expect(branches?.headers["accept-language"]).toBe("uk");
    // PUDO (700009) is not offered; 700010 does not issue to recipients.
    expect(points.map((point) => [point.ref, point.kind])).toEqual([
      ["700001", "branch"],
      ["700002", "branch"],
      ["700003", "branch"],
      ["700004", "branch"],
      ["700005", "locker"],
      ["700006", "locker"],
      ["700007", "locker"],
      ["700008", "locker"],
    ]);
    expect(points[0]).toEqual({
      ref: "700001",
      number: "1/1",
      kind: "branch",
      cityRef: String(STUB_CITY_ID),
      cityName: "Тестове Місто",
      countryCode: "UA",
      description: "Відділення №1, вул. Вигадана, 1",
      maxWeightGrams: 30000,
    });
    stub.requests.length = 0;
    await provider.listPickupPoints({ cityRef: String(STUB_CITY_ID), kinds: ["locker"] }, live());
    expect(stub.of("divisions").map((r) => r.query.getAll("divisionCategories[]"))).toEqual([
      ["Postomat"],
    ]);
    // A ref that is not a settlement id never reaches the carrier.
    expect(
      await provider.listPickupPoints({ cityRef: "kyiv'--", kinds: ["branch"] }, live()),
    ).toEqual([]);
    expect(stub.of("divisions")).toHaveLength(1);
  });

  it("finds one division by the undocumented ids[] filter (H16) and offers only branches and lockers that issue", async () => {
    const { provider } = providerOn(stub);
    const locker = await provider.findPickupPoint({ ref: "700005" }, live());
    expect(stub.of("divisions")[0]?.rawQuery).toBe("ids%5B%5D=700005&limit=2");
    expect(locker).toMatchObject({ ref: "700005", kind: "locker", maxWeightGrams: 20000 });
    expect(await provider.findPickupPoint({ ref: "700009" }, live())).toBeNull(); // PUDO
    expect(await provider.findPickupPoint({ ref: "700010" }, live())).toBeNull(); // not issuing
    expect(await provider.findPickupPoint({ ref: "799999" }, live())).toBeNull();
    const calls = stub.of("divisions").length;
    expect(await provider.findPickupPoint({ ref: "../shipments" }, live())).toBeNull();
    expect(stub.of("divisions")).toHaveLength(calls);
  });

  it("never picks another point when the filter is ignored (a whole list answered)", async () => {
    const { provider } = providerOn(stub);
    stub.override("divisions", () => ({
      status: 200,
      json: {
        current_page: 1,
        last_page: 4,
        per_page: 2,
        total: 8,
        items: [
          {
            id: 700001,
            number: "1/1",
            name: "A",
            divisionCategory: "PostBranch",
            countryCode: "UA",
            settlement: { id: 1, name: "X" },
          },
          {
            id: 700002,
            number: "1/2",
            name: "B",
            divisionCategory: "PostBranch",
            countryCode: "UA",
            settlement: { id: 1, name: "X" },
          },
        ],
      },
    }));
    await expect(provider.findPickupPoint({ ref: "700005" }, live())).rejects.toMatchObject({
      reason: "unavailable",
      codes: ["malformed_answer"],
    });
  });

  it("never takes a one-item answer that holds another division (review R6)", async () => {
    const { provider } = providerOn(stub);
    stub.override("divisions", () => ({
      status: 200,
      json: {
        current_page: 1,
        last_page: 1,
        total: 1,
        items: stubDivisions().filter((entry) => entry.id === 700006),
      },
    }));
    await expect(provider.findPickupPoint({ ref: "700005" }, live())).rejects.toMatchObject({
      reason: "unavailable",
      codes: ["malformed_answer"],
    });
  });

  it("creates a shipment with the spike's inline body and never sends it twice", async () => {
    const { provider } = providerOn(stub);
    const result = await provider.createWaybill(waybillRequest(), live());
    expect(result).toEqual({
      ok: true,
      value: {
        providerRef: stub.shipments[0]?.id,
        trackingNumber: stub.shipments[0]?.number,
        carrierCost: { amount: 8000, currency: "UAH" },
        estimatedDeliveryDate: "2026-10-27",
      },
    });
    const [create] = stub.of("createShipment");
    expect(stub.of("createShipment")).toHaveLength(1);
    // The fixture's reference is a real order number shape (what the API sends as `clientOrder`).
    expect(waybillRequest().clientReference).toMatch(ORDER_NUMBER_PATTERN);
    expect(create?.headers["content-type"]).toBe("application/json");
    expect(create?.body).toEqual({
      status: "ReadyToShip",
      clientOrder: "7K3M-9QX2",
      note: "Order 7K3M-9QX2",
      payerType: "Recipient",
      parcels: [
        {
          cargoCategory: "parcel",
          parcelDescription: "Order 7K3M-9QX2",
          // 1 250.50 UAH declared: whole hryvnias, rounded up.
          insuranceCost: 1251,
          rowNumber: 1,
          width: 150,
          length: 200,
          height: 100,
          actualWeight: 500,
        },
      ],
      sender: {
        companyTin: "",
        companyName: "",
        phone: STUB_PERSONAL.senderPhone,
        email: "",
        name: STUB_PERSONAL.senderName,
        countryCode: "UA",
        divisionId: STUB_SENDER_DIVISION_ID,
        addressParts: {},
      },
      recipient: {
        companyTin: "",
        companyName: "",
        phone: STUB_PERSONAL.recipientPhoneNormalized,
        email: "",
        name: `${STUB_PERSONAL.recipientFirstName} ${STUB_PERSONAL.recipientLastName}`,
        countryCode: "UA",
        divisionId: 700005,
        addressParts: {},
      },
    });
  });

  it("adds the contract number only when the sender pays, with the company of the profile", async () => {
    const { provider } = providerOn(stub);
    const settings = {
      ...VALID_SETTINGS,
      senderCompanyTin: "12345678",
      senderCompanyName: "ТОВ Вигадана",
      senderEmail: "shop@example.com",
      payerContractNumber: "ДОГ-1",
    };
    await provider.createWaybill(waybillRequest({ payer: "sender", settings }), live());
    await provider.createWaybill(
      waybillRequest({ clientReference: "7K3M-9QX3", payer: "recipient", settings }),
      live(),
    );
    const [bySender, byRecipient] = stub
      .of("createShipment")
      .map((r) => r.body as Record<string, unknown>);
    expect(bySender).toMatchObject({
      payerType: "Sender",
      payerContractNumber: "ДОГ-1",
      sender: { companyTin: "12345678", companyName: "ТОВ Вигадана", email: "shop@example.com" },
    });
    expect(byRecipient?.payerType).toBe("Recipient");
    expect(byRecipient).not.toHaveProperty("payerContractNumber");
  });

  it("prints the label by NUMBER with type=marking, not type[]=marking", async () => {
    const { provider } = providerOn(stub);
    const created = await provider.createWaybill(waybillRequest(), live());
    if (!created.ok) throw new Error("create failed");
    const label = await provider.fetchLabel(
      {
        providerRef: created.value.providerRef,
        trackingNumber: created.value.trackingNumber,
        format: "pdf",
      },
      live(),
    );
    const [print] = stub.of("print");
    expect(print?.rawQuery).toBe(`numbers%5B%5D=${created.value.trackingNumber}&type=marking`);
    expect(print?.query.getAll("type[]")).toEqual([]);
    expect(print?.headers.accept).toBe("application/pdf, application/json");
    expect(label.ok && new TextDecoder().decode(label.value.bytes).startsWith("%PDF-")).toBe(true);
  });

  it("deletes by the shipment's uuid and tracks by numbers[] (phones are not sent)", async () => {
    const { provider } = providerOn(stub);
    const created = await provider.createWaybill(waybillRequest(), live());
    if (!created.ok) throw new Error("create failed");
    const tracked = await provider.track(
      { trackingNumbers: [created.value.trackingNumber], phones: ["+380500000002"] },
      live(),
    );
    const [tracking] = stub.of("tracking");
    expect(tracking?.rawQuery).toBe(`numbers%5B%5D=${created.value.trackingNumber}`);
    expect(JSON.stringify(tracking?.headers)).not.toContain("380500000002");
    expect(tracked).toEqual({
      ok: true,
      value: [
        {
          trackingNumber: created.value.trackingNumber,
          status: "created",
          carrierStatusCode: "1",
          carrierStatusAt: new Date("2026-10-25T21:41:00.000Z"),
        },
      ],
    });
    expect(
      await provider.cancelWaybill({ providerRef: created.value.providerRef }, live()),
    ).toEqual({
      ok: true,
      value: undefined,
    });
    const [deleted] = stub.of("deleteShipment");
    expect(deleted?.method).toBe("DELETE");
    expect(deleted?.path).toBe(`/shipments/${created.value.providerRef}`);
  });

  it("prices a pickup point with the sender of the profile (estimate)", async () => {
    const { provider } = providerOn(stub);
    const result = await provider.estimate(
      {
        service: null,
        destination: {
          kind: "pickup_point",
          cityRef: String(STUB_CITY_ID),
          pickupPointRef: "700002",
        },
        declaredValue: { amount: 50_000, currency: "UAH" },
        parcel: null,
        settings: VALID_SETTINGS,
      },
      live(),
    );
    // 80 + 0.50 hryvnias.
    expect(result).toEqual({ ok: true, value: { amount: 8050, currency: "UAH" } });
    expect(stub.of("calculations")[0]?.body).toEqual({
      payerType: "Recipient",
      parcels: [
        {
          cargoCategory: "parcel",
          insuranceCost: 500,
          rowNumber: 1,
          width: 150,
          length: 200,
          height: 100,
          actualWeight: 500,
        },
      ],
      sender: {
        countryCode: "UA",
        divisionId: STUB_SENDER_DIVISION_ID,
        name: STUB_PERSONAL.senderName,
        phone: STUB_PERSONAL.senderPhone,
      },
      recipient: { countryCode: "UA", divisionId: 700002 },
    });
  });

  it("checks the connection with a fresh JWT and one authenticated read", async () => {
    const { provider } = providerOn(stub);
    await provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live());
    expect(await provider.checkConnection(live())).toEqual({ ok: true, value: undefined });
    // A second authorization although a token was cached: the key itself is tested.
    expect(stub.of("authorization")).toHaveLength(2);
    expect(stub.of("divisions")[0]?.rawQuery).toBe("countryCodes%5B%5D=UA&limit=1");
  });
});

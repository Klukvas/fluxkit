import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  carrierCodesOf,
  JWT_FALLBACK_LIFETIME_MS,
  JWT_REFRESH_MARGIN_MS,
  jwtExpiryMs,
  NovaPostCallError,
  NovaPostHttp,
} from "./http.js";
import { live, providerOn, waybillRequest } from "./test-support/fixtures.js";
import {
  captureLogger,
  STUB_API_KEY,
  STUB_CITY_ID,
  startStubCarrier,
  stubJwt,
  type StubCarrier,
} from "./test-support/stub-carrier.js";

const EXP_SECONDS = 2_000_000_000;
const EXP_MS = EXP_SECONDS * 1000;

describe("the JWT of the process (single flight, expiry, one retry on 401)", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
    stub.nextJwtExp = EXP_SECONDS;
  });

  afterEach(async () => {
    await stub.close();
  });

  it("reads exp from the token and keeps it until 5 minutes before", async () => {
    expect(jwtExpiryMs(stubJwt(1, EXP_SECONDS))).toBe(EXP_MS);
    expect(jwtExpiryMs(stubJwt(1, undefined))).toBeUndefined();
    expect(jwtExpiryMs("not-a-jwt")).toBeUndefined();
    expect(jwtExpiryMs("a.%%%.c")).toBeUndefined();

    let now = EXP_MS - 60 * 60_000;
    const { provider } = providerOn(stub, { now: () => now });
    const search = () => provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live());
    await search();
    now = EXP_MS - JWT_REFRESH_MARGIN_MS - 1;
    await search();
    expect(stub.of("authorization")).toHaveLength(1);
    now = EXP_MS - JWT_REFRESH_MARGIN_MS;
    await search();
    expect(stub.of("authorization")).toHaveLength(2);
    expect(stub.of("settlements")[2]?.headers.authorization).toBe(stub.issued[1]);
  });

  it("keeps a token without exp for 50 minutes", async () => {
    stub.nextJwtExp = undefined;
    let now = 1_000_000;
    const { provider } = providerOn(stub, { now: () => now });
    const search = () => provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live());
    await search();
    now += JWT_FALLBACK_LIFETIME_MS - 1;
    await search();
    expect(stub.of("authorization")).toHaveLength(1);
    now += 1;
    await search();
    expect(stub.of("authorization")).toHaveLength(2);
  });

  it("runs one authorization for concurrent callers (single flight)", async () => {
    stub.override("authorization", () => ({
      status: 200,
      json: { jwt: stubJwt(1, EXP_SECONDS) },
      delayMs: 50,
    }));
    stub.issued.push(stubJwt(1, EXP_SECONDS));
    const { provider } = providerOn(stub);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live()),
      ),
    );
    expect(stub.of("authorization")).toHaveLength(1);
    expect(stub.of("settlements")).toHaveLength(5);
  });

  it("lets one waiting caller give up without failing the others", async () => {
    stub.override("authorization", () => ({
      status: 200,
      json: { jwt: stubJwt(1, EXP_SECONDS) },
      delayMs: 80,
    }));
    stub.issued.push(stubJwt(1, EXP_SECONDS));
    const { provider } = providerOn(stub);
    const impatient = new AbortController();
    const first = provider.searchCities(
      { query: "Тест", locale: "uk", limit: 1 },
      impatient.signal,
    );
    const second = provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live());
    setTimeout(() => {
      impatient.abort(new Error("caller timeout"));
    }, 10);
    await expect(first).rejects.toMatchObject({ reason: "unavailable" });
    await expect(second).resolves.toHaveLength(1);
    expect(stub.of("authorization")).toHaveLength(1);
  });

  it("refreshes once on a 401 and repeats a read once; a second 401 is invalid_credentials", async () => {
    const { provider } = providerOn(stub);
    let rejected = 0;
    stub.override("divisions", () =>
      rejected++ < 1
        ? { status: 401, json: { errors: { errorMessage: "Invalid token" } } }
        : undefined,
    );
    const points = await provider.listPickupPoints(
      { cityRef: String(STUB_CITY_ID), kinds: ["locker"] },
      live(),
    );
    expect(points).toHaveLength(4);
    expect(stub.of("authorization")).toHaveLength(2);
    expect(stub.of("divisions")).toHaveLength(2);
    expect(stub.of("divisions")[1]?.headers.authorization).toBe(stub.issued[1]);

    stub.override("tracking", () => ({
      status: 401,
      json: { errors: { errorMessage: "Invalid token" } },
    }));
    expect(
      await provider.track({ trackingNumbers: ["20450000000001"], phones: [] }, live()),
    ).toEqual({
      ok: false,
      reason: "invalid_credentials",
      providerCodes: ["401"],
    });
    expect(stub.of("tracking")).toHaveLength(2);
    stub.override("settlements", () => ({
      status: 401,
      json: { errors: { errorMessage: "Invalid token" } },
    }));
    await expect(
      provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live()),
    ).rejects.toMatchObject({ reason: "invalid_credentials", codes: ["401"] });
  });

  it("NEVER repeats a create, not even after a 401 (no idempotency, H22)", async () => {
    const { provider } = providerOn(stub);
    await provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live());
    stub.override("createShipment", () => ({
      status: 401,
      json: { errors: { errorMessage: "Invalid token" } },
    }));
    const result = await provider.createWaybill(waybillRequest(), live());
    expect(result).toEqual({ ok: false, reason: "invalid_credentials", providerCodes: ["401"] });
    expect(stub.of("createShipment")).toHaveLength(1);
    expect(stub.of("authorization")).toHaveLength(1);
    // The dead token is forgotten: the next call authorizes again.
    stub.override("createShipment", undefined);
    await provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live());
    expect(stub.of("authorization")).toHaveLength(2);
  });

  it("does not repeat a create after a timeout, a 5xx or a malformed answer either", async () => {
    const { provider } = providerOn(stub);
    for (const answer of [
      { status: 503, json: { errors: { errorMessage: "Service Unavailable" } } },
      { status: 201, body: "<html>oops</html>", headers: { "content-type": "text/html" } },
      { status: 502, body: "bad gateway", headers: { "content-type": "text/plain" } },
    ]) {
      stub.requests.length = 0;
      stub.override("createShipment", () => answer);
      const result = await provider.createWaybill(waybillRequest(), live());
      // `unavailable`: the shipment may exist, so the API makes it `unknown` and reconciles; never `failed`.
      expect(result.ok ? "ok" : result.reason).toBe("unavailable");
      expect(stub.of("createShipment")).toHaveLength(1);
    }
    stub.requests.length = 0;
    stub.override("createShipment", () => ({ status: 201, hang: true }));
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new Error("API timeout"));
    }, 50);
    expect(await provider.createWaybill(waybillRequest(), controller.signal)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
    expect(stub.of("createShipment")).toHaveLength(1);
  });

  it("marks a create whose authorization failed as not sent: no POST left (review R3)", async () => {
    const { provider } = providerOn(stub);
    for (const [answer, codes] of [
      [
        { status: 503, json: { errors: { errorMessage: "Service Unavailable" } } },
        ["503", "errorMessage", "not_sent"],
      ],
      [
        { status: 429, json: { errors: { errorMessage: "Too Many Attempts." } } },
        ["429", "errorMessage", "not_sent"],
      ],
      [
        { status: 502, body: "bad gateway", headers: { "content-type": "text/plain" } },
        ["502", "not_sent"],
      ],
    ] as const) {
      stub.override("authorization", () => answer);
      expect(await provider.createWaybill(waybillRequest(), live())).toEqual({
        ok: false,
        reason: "unavailable",
        providerCodes: codes,
      });
    }
    expect(stub.of("createShipment")).toHaveLength(0);
    // A failure after the POST left is never "not sent".
    stub.override("authorization", undefined);
    stub.override("createShipment", () => ({ status: 503, json: { errors: {} } }));
    expect(await provider.createWaybill(waybillRequest(), live())).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: ["503"],
    });
    expect(stub.of("createShipment")).toHaveLength(1);
  });

  it("maps a refused key to invalid_credentials without the carrier's text", async () => {
    const { provider } = providerOn(stub, { apiKey: "wrong-key-0123456789abcdef" });
    expect(await provider.checkConnection(live())).toEqual({
      ok: false,
      reason: "invalid_credentials",
      providerCodes: ["422", "errorMessage"],
    });
    await expect(
      provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live()),
    ).rejects.toMatchObject({ reason: "invalid_credentials" });
  });
});

describe("transport failures, statuses and size caps", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("maps 429 and 5xx to unavailable, other 4xx to rejected, with codes and never text", async () => {
    const { provider } = providerOn(stub);
    stub.override("tracking", () => ({
      status: 429,
      json: { errors: { errorMessage: "Too Many Attempts." } },
    }));
    expect(
      await provider.track({ trackingNumbers: ["20450000000001"], phones: [] }, live()),
    ).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: ["429", "errorMessage"],
    });
    stub.override("settlements", () => ({
      status: 429,
      json: { errors: { errorMessage: "Too Many Attempts." } },
    }));
    await expect(
      provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live()),
    ).rejects.toMatchObject({ reason: "unavailable", codes: ["429", "errorMessage"] });
    stub.override("createShipment", () => ({
      status: 422,
      json: {
        errors: {
          "parcels.0.actualWeight": "The parcels.0.actualWeight field must be greater than 0.",
          errorMessage: "Contact Sender contains less than 2 words",
        },
      },
    }));
    expect(await provider.createWaybill(waybillRequest(), live())).toEqual({
      ok: false,
      reason: "rejected",
      providerCodes: ["422", "parcels.0.actualWeight", "errorMessage"],
    });
  });

  it("answers unavailable for a timeout of the caller's signal and of the request's own ceiling", async () => {
    const { provider, http } = providerOn(stub);
    stub.override("tracking", () => ({ status: 200, hang: true }));
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new Error("API timeout"));
    }, 30);
    expect(
      await provider.track({ trackingNumbers: ["20450000000001"], phones: [] }, controller.signal),
    ).toEqual({ ok: false, reason: "unavailable", providerCodes: ["timeout"] });
    await expect(
      http.request(
        {
          operation: "probe",
          method: "GET",
          path: "/shipments/tracking",
          maxBytes: 1024,
          timeoutMs: 30,
          retryOn401: true,
        },
        live(),
      ),
    ).rejects.toMatchObject({ reason: "unavailable", codes: ["timeout"] });
  });

  it("answers unavailable when the carrier cannot be reached", async () => {
    const closed = await startStubCarrier();
    const baseUrl = closed.baseUrl;
    await closed.close();
    const logger = captureLogger();
    const http = new NovaPostHttp({ baseUrl, apiKey: STUB_API_KEY, logger });
    await expect(http.jwt(live(), "probe")).rejects.toMatchObject({
      reason: "unavailable",
      codes: ["network"],
    });
    // The URL of the authorization call carries the key: it is never logged.
    expect(logger.lines.join("\n")).not.toContain(STUB_API_KEY);
    expect(logger.lines.join("\n")).not.toContain("127.0.0.1");
  });

  it("caps the body before parsing: by content-length and while reading", async () => {
    const { provider, http } = providerOn(stub);
    const created = await provider.createWaybill(waybillRequest(), live());
    if (!created.ok) throw new Error("create failed");
    const huge = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024)]);
    stub.override("print", () => ({
      status: 200,
      body: huge,
      headers: { "content-type": "application/pdf" },
    }));
    expect(
      await provider.fetchLabel(
        {
          providerRef: created.value.providerRef,
          trackingNumber: created.value.trackingNumber,
          format: "pdf",
        },
        live(),
      ),
    ).toEqual({ ok: false, reason: "unavailable", providerCodes: ["too_large"] });
    stub.override("tracking", () => ({
      status: 200,
      body: JSON.stringify({ items: [], padding: "x".repeat(4096) }),
      headers: { "content-type": "application/json" },
      chunked: true,
    }));
    await expect(
      http.request(
        {
          operation: "probe",
          method: "GET",
          path: "/shipments/tracking",
          maxBytes: 1024,
          timeoutMs: 5000,
          retryOn401: true,
        },
        live(),
      ),
    ).rejects.toMatchObject({ reason: "unavailable", codes: ["too_large"] });
  });

  it("treats a malformed answer as a typed failure, never a throw of a result operation", async () => {
    const { provider } = providerOn(stub);
    stub.override("tracking", () => ({
      status: 200,
      json: { items: [{ currentStatus: { number: 1 } }] },
    }));
    expect(
      await provider.track({ trackingNumbers: ["20450000000001"], phones: [] }, live()),
    ).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: ["malformed_answer"],
    });
    stub.override("tracking", () => ({
      status: 200,
      body: "{not json",
      headers: { "content-type": "application/json" },
    }));
    expect(
      await provider.track({ trackingNumbers: ["20450000000001"], phones: [] }, live()),
    ).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
    stub.override("settlements", () => ({ status: 200, json: { data: [] } }));
    await expect(
      provider.searchCities({ query: "Тест", locale: "uk", limit: 1 }, live()),
    ).rejects.toBeInstanceOf(NovaPostCallError);
  });

  it("keeps only codes: the status, short field names and snake_case values", () => {
    expect(carrierCodesOf(422, { errors: { errorMessage: "shipment_was_deleted" } })).toEqual([
      "422",
      "errorMessage",
      "shipment_was_deleted",
    ]);
    expect(
      carrierCodesOf(422, {
        errors: {
          errorMessage: "Recipient +380501234567 Іван is wrong",
          "a field name that is far too long to be a carrier code": "x",
          "sender.phone": "The sender.phone format is invalid.",
        },
      }),
    ).toEqual(["422", "errorMessage", "sender.phone"]);
    expect(carrierCodesOf(503, undefined)).toEqual(["503"]);
    // Only keys that look like a field path: a key that echoes a value (a phone, a key or JWT fragment) is never kept.
    expect(
      carrierCodesOf(422, {
        errors: {
          "stub-key-0123456789a": "x",
          "380501234567": "x",
          eyJhbGciOiJIUzI1NiIs: "x",
          "0123456789abcdef0123": "x",
          sender_phone_380501234567: "x",
          "parcels.0.actualWeight": "x",
          "items[1].name": "x",
          divisionId: "x",
          client_order: "x",
          errorMessage: "stub_key_0123456789",
        },
      }),
    ).toEqual([
      "422",
      "parcels.0.actualWeight",
      "items.1.name",
      "divisionId",
      "client_order",
      "errorMessage",
    ]);
    expect(
      carrierCodesOf(422, {
        errors: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${String(i)}`, "x"])),
      }),
    ).toHaveLength(10);
  });
});

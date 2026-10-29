import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MONOBANK_PATHS } from "./config.js";
import { MONOBANK_MAX_ANSWER_BYTES, MonobankHttp, type MonobankPath } from "./http.js";
import { aborted, live } from "./test-support/fixtures.js";
import { STUB_TOKEN, startStubMonobank, type StubMonobank } from "./test-support/stub-monobank.js";

/*
 * The transport rules (ADR 0032 decision 14): one fixed origin, redirects refused, the answer capped while streaming,
 * the caller's signal as the only time limit, the token only in the `X-Token` header.
 */
describe("MonobankHttp", () => {
  let stub: StubMonobank;
  let http: MonobankHttp;

  beforeEach(async () => {
    stub = await startStubMonobank();
    http = new MonobankHttp({ token: STUB_TOKEN, origin: stub.origin });
  });

  afterEach(async () => {
    await stub.close();
  });

  it("calls only https://api.monobank.ua, or a stub on 127.0.0.1 in a test", () => {
    expect(() => new MonobankHttp({ token: STUB_TOKEN })).not.toThrow();
    for (const origin of [
      "https://api.monobank.ua/",
      "http://api.monobank.ua",
      "https://api.monobank.ua.evil.example",
      "http://localhost:1234",
      "http://127.0.0.1:1234/api",
      "https://127.0.0.1:1234",
    ]) {
      expect(() => new MonobankHttp({ token: STUB_TOKEN, origin }), origin).toThrow(RangeError);
    }
  });

  it("calls only the plugin's fixed routes", async () => {
    await expect(
      http.call({ method: "GET", path: "/api/merchant/details" as MonobankPath }, live()),
    ).rejects.toThrow(RangeError);
    expect(stub.requests).toHaveLength(0);
  });

  it("sends the token only in X-Token and the invoice id only as an encoded query value", async () => {
    await http.call({ method: "GET", path: MONOBANK_PATHS.status, invoiceId: "p2_a&b=c" }, live());
    const request = stub.requests[0];
    expect(request?.headers["x-token"]).toBe(STUB_TOKEN);
    expect(request?.url).toBe("/api/merchant/invoice/status?invoiceId=p2_a%26b%3Dc");
    expect(request?.query).toEqual({ invoiceId: "p2_a&b=c" });
    expect(request?.url).not.toContain(STUB_TOKEN);
    expect(request?.rawBody).toBe("");
  });

  it("refuses a redirect (the token never follows it)", async () => {
    stub.override(() => ({
      status: 302,
      headers: { location: `${stub.origin}/elsewhere` },
      body: "",
    }));
    const exchange = await http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, live());
    expect(exchange).toEqual({ kind: "failed", code: "network" });
    expect(stub.requests.map((request) => request.path)).toEqual(["/api/merchant/pubkey"]);
  });

  it("refuses an answer over the cap, declared or streamed", async () => {
    const big = JSON.stringify({ key: "a".repeat(MONOBANK_MAX_ANSWER_BYTES) });
    stub.override(() => ({ status: 200, json: JSON.parse(big) as unknown }));
    expect(await http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, live())).toEqual({
      kind: "failed",
      code: "too_large",
      status: 200,
    });
    stub.override(() => ({
      status: 200,
      body: big,
      chunked: true,
      headers: { "content-type": "application/json" },
    }));
    expect(await http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, live())).toEqual({
      kind: "failed",
      code: "too_large",
      status: 200,
    });
    // Exactly at the cap is read.
    const exact = "x".repeat(MONOBANK_MAX_ANSWER_BYTES - 2);
    stub.override(() => ({
      status: 200,
      body: `"${exact}"`,
      chunked: true,
      headers: { "content-type": "application/json" },
    }));
    const read = await http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, live());
    expect(read.kind).toBe("answered");
  });

  it("sends nothing when the signal had already fired", async () => {
    expect(await http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, aborted())).toEqual({
      kind: "failed",
      code: "aborted_before_send",
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("ends a hanging call when the caller's signal fires (no own timeout)", async () => {
    stub.override(() => ({ status: 200, hang: true }));
    const controller = new AbortController();
    const pending = http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 50);
    expect(await pending).toEqual({ kind: "failed", code: "timeout" });
  });

  it("answers JSON only when declared, UTF-8 and parsable", async () => {
    const cases: [string, string, unknown][] = [
      ["application/json", '{"a":1}', { a: 1 }],
      ["application/json; charset=utf-8", '{"a":1}', { a: 1 }],
      ["text/plain", '{"a":1}', undefined],
      ["application/json", "{not json", undefined],
      ["application/json", "", undefined],
    ];
    for (const [type, body, json] of cases) {
      stub.override(() => ({ status: 200, body, headers: { "content-type": type } }));
      const exchange = await http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, live());
      expect(
        exchange.kind === "answered" ? exchange.answer.json : "failed",
        `${type} ${body}`,
      ).toEqual(json);
    }
    stub.override(() => ({
      status: 200,
      body: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
      headers: { "content-type": "application/json" },
    }));
    const latin = await http.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, live());
    expect(latin.kind === "answered" ? latin.answer.json : "failed").toBeUndefined();
  });

  it("reports a refused connection as a network failure", async () => {
    const closed = new MonobankHttp({ token: STUB_TOKEN, origin: stub.origin });
    await stub.close();
    expect(await closed.call({ method: "GET", path: MONOBANK_PATHS.pubkey }, live())).toEqual({
      kind: "failed",
      code: "network",
    });
    stub = await startStubMonobank();
  });
});

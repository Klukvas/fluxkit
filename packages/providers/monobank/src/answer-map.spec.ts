import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PaymentProviderResult } from "@fluxkit/core";
import { mapMonobankError, retryAfterSecondsOf } from "./answer-map.js";
import { createInput, live, providerOn, REFUND_ID } from "./test-support/fixtures.js";
import {
  STUB_TOKEN,
  startStubMonobank,
  type StubAnswer,
  type StubMonobank,
} from "./test-support/stub-monobank.js";

/*
 * Status and error mapping (ADR 0032 decisions 3 and 15; M16): by HTTP status first, refined only by a documented
 * `errCode`; `errText` and undocumented codes are never kept; anything that may have been processed is `unavailable`.
 */

function outcome(result: PaymentProviderResult<unknown>): unknown {
  return result.ok
    ? "ok"
    : {
        reason: result.reason,
        codes: result.providerCodes,
        ...(result.retryAfterSeconds === undefined ? {} : { retry: result.retryAfterSeconds }),
      };
}

const answer = (status: number, json?: unknown, retryAfter: string | null = null) => ({
  status,
  json,
  retryAfter,
  empty: json === undefined,
});

describe("mapMonobankError", () => {
  it("maps every documented status and code", () => {
    const table: [number, unknown, unknown][] = [
      [
        400,
        { errCode: "BAD_REQUEST", errText: "x" },
        { reason: "rejected", codes: ["BAD_REQUEST", "400"] },
      ],
      [400, { errCode: "1001", errText: "x" }, { reason: "rejected", codes: ["1001", "400"] }],
      [400, { errCode: 1001, errText: "x" }, { reason: "rejected", codes: ["1001", "400"] }],
      [
        400,
        { errCode: "INVALID_MERCHANT_PAYM_INFO", errText: "x" },
        { reason: "rejected", codes: ["INVALID_MERCHANT_PAYM_INFO", "400"] },
      ],
      [
        400,
        { errCode: "WRONG_CANCEL_AMOUNT", errText: "x" },
        { reason: "rejected", codes: ["WRONG_CANCEL_AMOUNT", "400"] },
      ],
      // A 400 without a documented code did not come from the API layer as documented.
      [
        400,
        { errCode: "SOMETHING_NEW", errText: "x" },
        { reason: "unavailable", codes: ["unnamed_error", "400"] },
      ],
      [400, undefined, { reason: "unavailable", codes: ["unnamed_error", "400"] }],
      [
        403,
        { errCode: "FORBIDDEN", errText: "forbidden" },
        { reason: "misconfigured", codes: ["FORBIDDEN", "403"] },
      ],
      [403, undefined, { reason: "misconfigured", codes: ["403"] }],
      [
        404,
        { errCode: "NOT_FOUND", errText: "x" },
        { reason: "not_found", codes: ["NOT_FOUND", "404"] },
      ],
      [404, { errCode: "1004", errText: "x" }, { reason: "not_found", codes: ["1004", "404"] }],
      // A 404 without a documented code (a proxy, a wrong route) is never a false "no such invoice".
      [404, undefined, { reason: "unavailable", codes: ["404"] }],
      [
        404,
        { errCode: "INTERNAL_ERROR" },
        { reason: "unavailable", codes: ["INTERNAL_ERROR", "404"] },
      ],
      [
        405,
        { errCode: "METHOD_NOT_ALLOWED", errText: "x" },
        { reason: "misconfigured", codes: ["METHOD_NOT_ALLOWED", "405"] },
      ],
      [
        429,
        { errCode: "TMR", errText: "too many requests" },
        { reason: "rate_limited", codes: ["TMR", "429"] },
      ],
      [429, undefined, { reason: "rate_limited", codes: ["429"] }],
      [
        500,
        { errCode: "INTERNAL_ERROR", errText: "x" },
        { reason: "unavailable", codes: ["INTERNAL_ERROR", "500"] },
      ],
      [
        500,
        { errCode: "CANCEL_NOT_AVAILABLE", errText: "x" },
        { reason: "not_cancellable", codes: ["CANCEL_NOT_AVAILABLE", "500"] },
      ],
      [502, undefined, { reason: "unavailable", codes: ["502"] }],
      [
        503,
        { errCode: "CANCEL_NOT_AVAILABLE" },
        { reason: "unavailable", codes: ["CANCEL_NOT_AVAILABLE", "503"] },
      ],
      [408, undefined, { reason: "unavailable", codes: ["408"] }],
      // Undocumented statuses: the request may have been processed.
      [
        401,
        { errCode: "FORBIDDEN" },
        { reason: "unavailable", codes: ["unexpected_status", "401"] },
      ],
      [409, undefined, { reason: "unavailable", codes: ["unexpected_status", "409"] }],
      [
        422,
        { errCode: "BAD_REQUEST" },
        { reason: "unavailable", codes: ["unexpected_status", "422"] },
      ],
      [302, undefined, { reason: "unavailable", codes: ["unexpected_status", "302"] }],
    ];
    for (const [status, json, expected] of table) {
      expect(
        outcome(mapMonobankError(answer(status, json))),
        `${String(status)} ${JSON.stringify(json)}`,
      ).toEqual(expected);
    }
  });

  it("keeps no errText and no undocumented code, whatever they contain", () => {
    const hostile = [
      { errCode: "BAD REQUEST with spaces", errText: STUB_TOKEN },
      { errCode: STUB_TOKEN, errText: STUB_TOKEN },
      { errCode: "x".repeat(65), errText: "y" },
      { errCode: { nested: true } },
      { errText: "only text" },
      "a plain string",
      [1, 2, 3],
    ];
    for (const json of hostile) {
      for (const status of [400, 403, 404, 405, 429, 500, 503]) {
        const failure = mapMonobankError(answer(status, json));
        expect(JSON.stringify(failure)).not.toContain(STUB_TOKEN);
        expect(JSON.stringify(failure)).not.toContain("text");
        expect(JSON.stringify(failure)).not.toContain("spaces");
      }
    }
  });

  it("passes on a Retry-After in seconds only (M17: UNKNOWN whether Monobank sends one)", () => {
    expect(outcome(mapMonobankError(answer(429, { errCode: "TMR" }, "30")))).toEqual({
      reason: "rate_limited",
      codes: ["TMR", "429"],
      retry: 30,
    });
    expect(retryAfterSecondsOf(" 0 ")).toBe(0);
    expect(retryAfterSecondsOf("86400")).toBe(86_400);
    expect(retryAfterSecondsOf("86401")).toBeUndefined();
    expect(retryAfterSecondsOf("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
    expect(retryAfterSecondsOf("-1")).toBeUndefined();
    expect(retryAfterSecondsOf("1.5")).toBeUndefined();
    expect(retryAfterSecondsOf(null)).toBeUndefined();
    // A Retry-After on another status is not a rate limit.
    expect(outcome(mapMonobankError(answer(503, undefined, "30")))).toEqual({
      reason: "unavailable",
      codes: ["503"],
    });
  });
});

describe("every operation maps failures the same way, and never retries", () => {
  let stub: StubMonobank;

  beforeEach(async () => {
    stub = await startStubMonobank();
  });

  afterEach(async () => {
    await stub.close();
  });

  const operations = (provider: ReturnType<typeof providerOn>["provider"]) =>
    [
      ["createPayment", () => provider.createPayment(createInput(), live())],
      ["getPayment", () => provider.getPayment("p2_stub000001", live())],
      ["invalidatePayment", () => provider.invalidatePayment("p2_stub000001", live())],
      [
        "refund",
        () =>
          provider.refund(
            {
              providerPaymentId: "p2_stub000001",
              refundId: REFUND_ID,
              amount: { amount: 100, currency: "UAH" },
              full: false,
            },
            live(),
          ),
      ],
    ] as const;

  it("answers 429 TMR as rate_limited, 5xx and unreadable 2xx as unavailable, one request each", async () => {
    const { provider } = providerOn(stub);
    const cases: [StubAnswer, unknown][] = [
      [
        {
          status: 429,
          json: { errCode: "TMR", errText: "too many requests" },
          headers: { "retry-after": "7" },
        },
        { reason: "rate_limited", codes: ["TMR", "429"], retry: 7 },
      ],
      [
        { status: 500, json: { errCode: "INTERNAL_ERROR", errText: "x" } },
        { reason: "unavailable", codes: ["INTERNAL_ERROR", "500"] },
      ],
      [
        { status: 503, body: "<html>bad gateway</html>", headers: { "content-type": "text/html" } },
        { reason: "unavailable", codes: ["503"] },
      ],
      [
        { status: 403, json: { errCode: "FORBIDDEN", errText: "forbidden" } },
        { reason: "misconfigured", codes: ["FORBIDDEN", "403"] },
      ],
    ];
    for (const [stubAnswer, expected] of cases) {
      stub.override(() => stubAnswer);
      for (const [name, call] of operations(provider)) {
        const before = stub.requests.length;
        expect(outcome(await call()), `${name} ${String(stubAnswer.status)}`).toEqual(expected);
        expect(stub.requests.length - before, `${name} sent once`).toBe(1);
      }
    }
  });

  it("answers an unreadable 2xx as unavailable (the invoice or refund may exist), never as a refusal", async () => {
    const { provider } = providerOn(stub);
    const unreadable: StubAnswer[] = [
      { status: 200, body: "not json", headers: { "content-type": "text/plain" } },
      { status: 200, body: "{broken", headers: { "content-type": "application/json" } },
      { status: 200, json: { unexpected: true } },
      { status: 201, json: [] },
    ];
    for (const stubAnswer of unreadable) {
      stub.override(() => stubAnswer);
      for (const [name, call] of operations(provider)) {
        if (name === "invalidatePayment") {
          // M14: the success is an empty answer; any 2xx is taken as done without reading it.
          expect(outcome(await call())).toBe("ok");
          continue;
        }
        const result = await call();
        expect(result.ok, name).toBe(false);
        if (!result.ok) {
          expect(result.reason, name).toBe("unavailable");
          expect(result.providerCodes[0], name).toMatch(/^(malformed_answer|answer_mismatch)$/);
        }
      }
    }
  });

  it("answers a timeout or a dropped connection as unavailable (may have reached Monobank)", async () => {
    const { provider } = providerOn(stub);
    stub.override(() => ({ status: 200, hang: true }));
    const controller = new AbortController();
    const pending = provider.createPayment(createInput(), controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 30);
    expect(outcome(await pending)).toEqual({ reason: "unavailable", codes: ["timeout"] });
  });

  it("answers an oversized 2xx as unavailable", async () => {
    const { provider } = providerOn(stub);
    stub.override(() => ({
      status: 200,
      json: { invoiceId: "p2_x", pageUrl: "x".repeat(70_000) },
    }));
    expect(outcome(await provider.createPayment(createInput(), live()))).toEqual({
      reason: "unavailable",
      codes: ["too_large", "200"],
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapResendAnswer, resendErrorNameOf, retryAfterSecondsOf } from "./answer-map.js";
import { live, message, MESSAGE_ID, providerOn } from "./test-support/fixtures.js";
import { startStubResend, type StubAnswer, type StubResend } from "./test-support/stub-resend.js";

/*
 * Every status of the plan's R4, R7 and R8 (and the gaps between them) as a typed result, through the real HTTP layer
 * against the stub (ADR 0031 decision 6: the reason decides the outbox status; the codes are what `last_error_code`
 * shows).
 */

const err = (status: number, name: string, extra: Partial<StubAnswer> = {}): StubAnswer => ({
  status,
  json: { statusCode: status, name, message: "text the plugin must not keep" },
  ...extra,
});

describe("Resend answers as typed results", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  async function sendWith(answer: StubAnswer) {
    stub.override(() => answer);
    const { provider, logger } = providerOn(stub);
    const result = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    return { result, logger };
  }

  const table: [string, StubAnswer, Record<string, unknown>][] = [
    [
      "200 {id}",
      { status: 200, json: { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", object: "email" } },
      { ok: true, value: { providerMessageId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" } },
    ],
    [
      "400 validation_error (a field, or a bad key: R8 ambiguity, read as a field)",
      err(400, "validation_error"),
      { ok: false, reason: "rejected", providerCodes: ["validation_error", "400"] },
    ],
    [
      "400 invalid_idempotency_key",
      err(400, "invalid_idempotency_key"),
      { ok: false, reason: "rejected", providerCodes: ["invalid_idempotency_key", "400"] },
    ],
    [
      "400 without a documented name",
      { status: 400, body: "<html>Bad Request</html>", headers: { "content-type": "text/html" } },
      { ok: false, reason: "unavailable", providerCodes: ["unnamed_error", "400"] },
    ],
    [
      "401 missing_api_key",
      err(401, "missing_api_key"),
      { ok: false, reason: "misconfigured", providerCodes: ["missing_api_key", "401"] },
    ],
    [
      "401 restricted_api_key",
      err(401, "restricted_api_key"),
      { ok: false, reason: "misconfigured", providerCodes: ["restricted_api_key", "401"] },
    ],
    [
      "401 validation_error (key rejected)",
      err(401, "validation_error"),
      { ok: false, reason: "misconfigured", providerCodes: ["validation_error", "401"] },
    ],
    [
      "403 validation_error (testing mode, domain not verified)",
      err(403, "validation_error"),
      { ok: false, reason: "misconfigured", providerCodes: ["validation_error", "403"] },
    ],
    [
      "403 suspended_api_key",
      err(403, "suspended_api_key"),
      { ok: false, reason: "misconfigured", providerCodes: ["suspended_api_key", "403"] },
    ],
    [
      "403 without a User-Agent (plain text, R6)",
      { status: 403, body: "error code: 1010", headers: { "content-type": "text/plain" } },
      { ok: false, reason: "misconfigured", providerCodes: ["403"] },
    ],
    [
      "404 not_found",
      err(404, "not_found"),
      { ok: false, reason: "misconfigured", providerCodes: ["not_found", "404"] },
    ],
    [
      "405",
      err(405, "method_not_allowed"),
      { ok: false, reason: "misconfigured", providerCodes: ["405"] },
    ],
    ["408", { status: 408 }, { ok: false, reason: "unavailable", providerCodes: ["408"] }],
    [
      "409 concurrent_idempotent_requests",
      err(409, "concurrent_idempotent_requests"),
      {
        ok: false,
        reason: "unavailable",
        providerCodes: ["concurrent_idempotent_requests", "409"],
      },
    ],
    [
      "409 invalid_idempotent_request",
      err(409, "invalid_idempotent_request"),
      {
        ok: false,
        reason: "idempotency_conflict",
        providerCodes: ["invalid_idempotent_request", "409"],
      },
    ],
    [
      "409 resource_locked",
      err(409, "resource_locked"),
      { ok: false, reason: "unavailable", providerCodes: ["resource_locked", "409"] },
    ],
    [
      "409 without a name",
      { status: 409 },
      { ok: false, reason: "unavailable", providerCodes: ["409"] },
    ],
    [
      "413 (undocumented 4xx)",
      { status: 413 },
      { ok: false, reason: "rejected", providerCodes: ["413"] },
    ],
    [
      "422 missing_required_field",
      err(422, "missing_required_field"),
      { ok: false, reason: "rejected", providerCodes: ["missing_required_field", "422"] },
    ],
    [
      "422 invalid_parameter",
      err(422, "invalid_parameter"),
      { ok: false, reason: "rejected", providerCodes: ["invalid_parameter", "422"] },
    ],
    [
      "422 invalid_attachment",
      err(422, "invalid_attachment"),
      { ok: false, reason: "rejected", providerCodes: ["invalid_attachment", "422"] },
    ],
    [
      "422 without a documented name",
      err(422, "Internal Server Error"),
      { ok: false, reason: "unavailable", providerCodes: ["unnamed_error", "422"] },
    ],
    [
      "429 rate_limit_exceeded with retry-after",
      err(429, "rate_limit_exceeded", { headers: { "retry-after": "2" } }),
      {
        ok: false,
        reason: "rate_limited",
        providerCodes: ["rate_limit_exceeded", "429"],
        retryAfterSeconds: 2,
      },
    ],
    [
      "429 daily_quota_exceeded",
      err(429, "daily_quota_exceeded", { headers: { "retry-after": "3600" } }),
      {
        ok: false,
        reason: "quota_exceeded",
        providerCodes: ["daily_quota_exceeded", "429"],
        quotaPeriod: "daily",
        retryAfterSeconds: 3600,
      },
    ],
    [
      "429 monthly_quota_exceeded",
      err(429, "monthly_quota_exceeded"),
      {
        ok: false,
        reason: "quota_exceeded",
        providerCodes: ["monthly_quota_exceeded", "429"],
        quotaPeriod: "monthly",
      },
    ],
    [
      "429 without a name or retry-after",
      { status: 429 },
      { ok: false, reason: "rate_limited", providerCodes: ["429"] },
    ],
    [
      "500 application_error",
      err(500, "application_error"),
      { ok: false, reason: "unavailable", providerCodes: ["application_error", "500"] },
    ],
    [
      "502 (an HTML gateway page)",
      { status: 502, body: "<html>bad gateway</html>", headers: { "content-type": "text/html" } },
      { ok: false, reason: "unavailable", providerCodes: ["502"] },
    ],
    [
      "503 service_unavailable with retry-after",
      err(503, "service_unavailable", { headers: { "retry-after": "30" } }),
      {
        ok: false,
        reason: "unavailable",
        providerCodes: ["service_unavailable", "503"],
        retryAfterSeconds: 30,
      },
    ],
    ["504", { status: 504 }, { ok: false, reason: "unavailable", providerCodes: ["504"] }],
  ];

  for (const [name, answer, expected] of table) {
    it(`maps ${name}`, async () => {
      const { result, logger } = await sendWith(answer);
      expect(result).toEqual(expected);
      expect(stub.requests).toHaveLength(1); // never repeated by the plugin
      if (result.ok) {
        expect(logger.lines).toEqual([]);
      } else {
        expect(logger.lines).toHaveLength(1);
        expect(logger.lines[0]).toMatch(
          new RegExp(`^warn send: HTTP ${String(answer.status)} -> ${result.reason} \\(`),
        );
        expect(logger.lines[0]).not.toContain("must not keep");
      }
    });
  }

  describe("an unreadable 2xx is unavailable, never a failure that could drop a sent mail", () => {
    const unreadable: [string, StubAnswer][] = [
      ["no body", { status: 200 }],
      ["not JSON", { status: 200, body: "OK", headers: { "content-type": "text/plain" } }],
      [
        "malformed JSON",
        { status: 200, body: '{"id": "4ef9', headers: { "content-type": "application/json" } },
      ],
      ["no id", { status: 200, json: { object: "email" } }],
      ["an id that is not a code", { status: 200, json: { id: "an id with spaces" } }],
      ["an id too long", { status: 200, json: { id: "a".repeat(65) } }],
      ["an array", { status: 200, json: [{ id: "4ef9a417" }] }],
      ["202 without a body", { status: 202 }],
    ];
    for (const [name, answer] of unreadable) {
      it(name, async () => {
        const { result } = await sendWith(answer);
        expect(result).toEqual({
          ok: false,
          reason: "unavailable",
          providerCodes: ["malformed_answer", String(answer.status)],
        });
      });
    }
  });

  it("refuses to follow a redirect (the key never goes to another host)", async () => {
    const target = await startStubResend();
    try {
      const { result } = await sendWith({
        status: 307,
        headers: { location: target.endpoint },
      });
      expect(result).toEqual({ ok: false, reason: "unavailable", providerCodes: ["network"] });
      expect(target.requests).toHaveLength(0);
    } finally {
      await target.close();
    }
  });
});

describe("pure helpers", () => {
  it("reads only documented error names; anything else is dropped, never echoed", () => {
    expect(resendErrorNameOf({ statusCode: 429, name: "daily_quota_exceeded" })).toBe(
      "daily_quota_exceeded",
    );
    for (const json of [
      undefined,
      null,
      "validation_error",
      { name: 7 },
      { name: "re_0123456789abcdef" },
      { name: "someone@example.com" },
      { name: "Validation_Error" },
      { name: "validation_error ".repeat(10) },
      { error: { name: "validation_error" } },
    ]) {
      expect(resendErrorNameOf(json)).toBeUndefined();
    }
  });

  it("reads retry-after as whole seconds only (R7); an HTTP-date or anything else is ignored", () => {
    expect(retryAfterSecondsOf("5")).toBe(5);
    expect(retryAfterSecondsOf(" 7 ")).toBe(7);
    expect(retryAfterSecondsOf("0")).toBe(0);
    expect(retryAfterSecondsOf(String(31 * 24 * 3600))).toBe(31 * 24 * 3600);
    for (const header of [
      null,
      "",
      "-1",
      "1.5",
      "1e3",
      "abc",
      "Wed, 21 Oct 2026 07:28:00 GMT",
      String(31 * 24 * 3600 + 1),
      "123456789",
    ]) {
      expect(retryAfterSecondsOf(header)).toBeUndefined();
    }
  });

  it("maps statuses no table row names", () => {
    expect(mapResendAnswer({ status: 304, retryAfter: null, json: undefined })).toEqual({
      ok: false,
      reason: "unavailable",
      providerCodes: ["unexpected_status", "304"],
    });
    expect(mapResendAnswer({ status: 410, retryAfter: null, json: undefined })).toEqual({
      ok: false,
      reason: "rejected",
      providerCodes: ["410"],
    });
  });
});

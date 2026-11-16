import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapBrevoAnswer, retryAfterSecondsOf } from "./answer-map.js";
import { live, message, MESSAGE_ID, providerOn } from "./test-support/fixtures.js";
import { startStubBrevo, type StubBrevo } from "./test-support/stub-brevo.js";

describe("Brevo answer mapping through HTTP", () => {
  let stub: StubBrevo;
  beforeEach(async () => {
    stub = await startStubBrevo();
  });
  afterEach(async () => {
    await stub?.close();
  });
  it.each([
    [401, "unauthorized", "misconfigured"],
    [403, "permission_denied", "misconfigured"],
    [402, "account_under_validation", "misconfigured"],
    [400, "invalid_parameter", "rejected"],
    [400, "missing_parameter", "rejected"],
    [400, "out_of_range", "rejected"],
    [400, "duplicate_parameter", "idempotency_conflict"],
    [429, "invalid_parameter", "rate_limited"],
    [400, "not_enough_credits", "unavailable"],
    [402, "not_enough_credits", "unavailable"],
    [400, "duplicate_request", "unavailable"],
    [422, "invalid_parameter", "unavailable"],
    [408, "invalid_parameter", "unavailable"],
    [500, "invalid_parameter", "unavailable"],
    [503, "not_enough_credits", "unavailable"],
    [401, "alien_code", "unavailable"],
  ])("%i %s becomes %s without retaining message text", async (status, code, reason) => {
    stub.override(() => ({ status, json: { code, message: "recipient@example.com secret" } }));
    const result = await providerOn(stub).provider.send(
      message(),
      { idempotencyKey: MESSAGE_ID },
      live(),
    );
    expect(result).toMatchObject({ ok: false, reason });
    expect(result).not.toHaveProperty("quotaPeriod");
    expect(JSON.stringify(result)).not.toContain("recipient@example.com");
    if (code === "alien_code") expect(JSON.stringify(result)).not.toContain(code);
  });
  it("refuses redirects without forwarding the key or making another POST", async () => {
    stub.override(() => ({ status: 307, headers: { location: stub.endpoint }, json: {} }));
    expect(
      await providerOn(stub).provider.send(message(), { idempotencyKey: MESSAGE_ID }, live()),
    ).toMatchObject({ reason: "unavailable" });
    expect(stub.requests).toHaveLength(1);
  });
});

describe("Brevo answer policy (no network)", () => {
  it("keeps duplicate_parameter as an idempotency conflict without assuming acceptance", () => {
    expect(
      mapBrevoAnswer({
        status: 400,
        retryAfter: null,
        json: { code: "duplicate_parameter", message: "Duplicate UUID" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "idempotency_conflict",
      providerCodes: ["duplicate_parameter", "400"],
    });
  });
  it("checks every 5xx before considering a safe-looking body", () => {
    for (let status = 500; status <= 599; status++) {
      expect(
        mapBrevoAnswer({
          status,
          retryAfter: null,
          json: { code: "invalid_parameter", message: "refused" },
        }),
      ).toMatchObject({ ok: false, reason: "unavailable", providerCodes: [String(status)] });
    }
  });
  it("accepts only 201 with one valid verbatim reference; malformed and unexpected envelopes are ambiguous", () => {
    const id = "<Mixed.Case+123@SMTP.example>";
    expect(mapBrevoAnswer({ status: 201, retryAfter: null, json: { messageId: id } })).toEqual({
      ok: true,
      value: { providerMessageId: id },
    });
    for (const json of [
      null,
      {},
      [],
      { messageId: "<a@b>\n" },
      { messageId: "<a@b>,<c@d>" },
      { messageId: `<${"a".repeat(252)}@b>` },
    ]) {
      expect(mapBrevoAnswer({ status: 201, retryAfter: null, json })).toMatchObject({
        reason: "unavailable",
      });
    }
    for (const status of [200, 202, 301, 400, 401, 402, 403, 429]) {
      expect(
        mapBrevoAnswer({ status, retryAfter: null, json: { message: "invalid_parameter" } }),
      ).toMatchObject({ reason: "unavailable" });
    }
  });
  it("uses bounded seconds Retry-After and ignores unverified reset units", () => {
    expect(retryAfterSecondsOf(" 17 ")).toBe(17);
    for (const value of ["-1", "1.5", "99999999", "Wed, 21 Oct 2030 07:28:00 GMT"])
      expect(retryAfterSecondsOf(value)).toBeUndefined();
    const answer = {
      status: 429,
      retryAfter: "30",
      rateLimitReset: "9000",
      json: { code: "invalid_parameter", message: "throttled" },
    };
    expect(mapBrevoAnswer(answer)).toMatchObject({ reason: "rate_limited", retryAfterSeconds: 30 });
  });
});

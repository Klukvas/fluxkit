import { describe, expect, it } from "vitest";
import { readBrevoWebhookSecret } from "./config.js";
import { createBrevoWebhookVerifier } from "./webhook.js";

const SECRET = "Invented_Webhook_Token_For_Unit_Tests_0123456789";
const now = new Date("2026-11-16T12:00:00Z");
const verify = createBrevoWebhookVerifier(SECRET);
const base = {
  event: "hard_bounce",
  email: " Person@Example.Test ",
  id: 17,
  "message-id": "<invented-id@example.test>",
  ts_event: now.getTime() / 1000,
};
function request(
  body: unknown = base,
  authorization: string | string[] | undefined = `Bearer ${SECRET}`,
) {
  return { rawBody: Buffer.from(JSON.stringify(body)), headers: { authorization }, now };
}

describe("Brevo dedicated bearer authentication", () => {
  it("accepts exact bearer credentials and emits only validated allowlisted facts", () => {
    expect(verify(request())).toEqual({
      ok: true,
      ignored: false,
      facts: [
        {
          eventKey: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
          recipient: "person@example.test",
          reason: "hard_bounce",
          eventAt: now,
        },
      ],
    });
    expect(verify({ ...request(), headers: {} })).toEqual({ ok: false, reason: "unauthenticated" });
    for (const authorization of [
      "",
      `bearer ${SECRET}`,
      `Bearer ${SECRET} `,
      `Bearer ${SECRET.slice(0, -1)}`,
      `Bearer ${"x".repeat(1025)}`,
      [`Bearer ${SECRET}`],
      `Bearer ${SECRET}\r\nInjected: yes`,
    ]) {
      expect(verify(request(base, authorization))).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
    }
  });
  it("authenticates before JSON parsing; malformed authenticated input is a client error", () => {
    const rawBody = Buffer.from("not JSON");
    expect(verify({ ...request(), rawBody, headers: {} })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(verify({ ...request(), rawBody })).toEqual({ ok: false, reason: "malformed" });
    for (const body of [
      null,
      [],
      [base],
      "text",
      { ...base, email: "bad" },
      { ...base, id: "17" },
      { ...base, id: -1 },
      { ...base, id: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, "message-id": "" },
      { ...base, "message-id": "x".repeat(256) },
      { ...base, "message-id": "id\n" },
      { ...base, ts_event: "123" },
      { ...base, ts_event: 1.5 },
      { ...base, ts_event: -1 },
      { ...base, ts_event: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(verify(request(body))).toEqual({ ok: false, reason: "malformed" });
    }
  });
  it("maps exactly hard bounce, spam, unsubscribed and blocked; irrelevant/soft bounce never suppress", () => {
    for (const [event, reason] of [
      ["hard_bounce", "hard_bounce"],
      ["spam", "complaint"],
      ["unsubscribed", "unsubscribe"],
      ["blocked", "blocked"],
    ]) {
      const result = verify(request({ ...base, event, reason: "private vendor text" }));
      expect(result).toMatchObject({ ok: true, ignored: false, facts: [{ reason }] });
      expect(JSON.stringify(result)).not.toContain("private vendor text");
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
    for (const event of [
      "soft_bounce",
      "delivered",
      "opened",
      "click",
      "deferred",
      "request",
      "__proto__",
      "constructor",
    ]) {
      expect(verify(request({ event }))).toEqual({ ok: true, facts: [], ignored: true });
    }
  });
  it("deduplicates the complete validated normalized tuple, never webhook ID alone", () => {
    const first = verify(request());
    expect(verify(request({ ...base, email: "person@example.test" }))).toEqual(first);
    if (!first.ok) throw new Error("expected facts");
    const key = first.facts[0]?.eventKey;
    for (const change of [
      { id: 18 },
      { "message-id": "<other-id@example.test>" },
      { email: "other@example.test" },
      { event: "spam" },
      { ts_event: base.ts_event + 1 },
    ]) {
      const result = verify(request({ ...base, ...change }));
      if (!result.ok) throw new Error("expected facts");
      expect(result.facts[0]?.eventKey).not.toBe(key);
    }
    // An old/future event is authenticated but core, rather than this plugin, decides the event-age policy.
    expect(verify(request({ ...base, ts_event: 1 })).ok).toBe(true);
  });
});

describe("Brevo webhook-secret accessor", () => {
  it("disables a blank secret and accepts bounded header-safe high-entropy token shapes", () => {
    for (const secret of [undefined, "", "  "])
      expect(readBrevoWebhookSecret({ BREVO_WEBHOOK_SECRET: secret })).toBeUndefined();
    for (const secret of [SECRET, "a".repeat(43), "_".repeat(1024)])
      expect(readBrevoWebhookSecret({ BREVO_WEBHOOK_SECRET: secret })).toBe(secret);
  });
  it("refuses invalid nonblank secrets with code-only errors", () => {
    for (const secret of [
      "a".repeat(42),
      "a".repeat(1025),
      `${SECRET}=`,
      `${SECRET} `,
      ` ${SECRET}`,
      `${SECRET}\n`,
      `${SECRET}é`,
      `${SECRET}/`,
    ]) {
      expect(() => readBrevoWebhookSecret({ BREVO_WEBHOOK_SECRET: secret })).toThrow(
        "BREVO_WEBHOOK_SECRET must contain 43 to 1024 URL-safe base64 characters (the value is not shown).",
      );
    }
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readResendWebhookSecret } from "./config.js";
import { createResendWebhookVerifier } from "./webhook.js";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const id = "msg_p5jXN8AQM2LWM0D4loKWxJek";
const timestamp = 1614265330;
const now = new Date(timestamp * 1000);
const verify = createResendWebhookVerifier(SECRET);
function signed(rawBody: Uint8Array, time = timestamp, deliveryId = id) {
  const signature = createHmac("sha256", Buffer.from(SECRET.slice(6), "base64"))
    .update(`${deliveryId}.${String(time)}.`)
    .update(rawBody)
    .digest("base64");
  return {
    "svix-id": deliveryId,
    "svix-timestamp": String(time),
    "svix-signature": `v1,${signature}`,
  };
}
function event(
  type: string,
  data: unknown = { to: [" Person@Example.Test "] },
  created_at = now.toISOString(),
) {
  const rawBody = Buffer.from(JSON.stringify({ type, data, created_at }));
  return { rawBody, headers: signed(rawBody), now };
}

describe("Resend raw-byte Svix verification", () => {
  it("rejects a signature that does not match the raw-body tuple", () => {
    const rawBody = Buffer.from('{"test": 2432232314}');
    const headers = signed(rawBody);
    expect(headers["svix-signature"]).toBe("v1,PxHZe96mbQZz2qjqqFruykIqYbPOK6W3bwdPtIj4ocY=");
    expect(
      verify({
        rawBody,
        headers: {
          ...headers,
          "svix-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
        },
        now,
      }),
    ).toEqual({ ok: false, reason: "unauthenticated" });
    expect(verify({ rawBody, headers, now })).toEqual({ ok: false, reason: "malformed" });
  });
  it("authenticates the complete published Svix test vector before parsing its non-event payload", () => {
    // https://docs.svix.com/receiving/verifying-payloads/how-manual (Example signatures).
    const official = createResendWebhookVerifier("whsec_plJ3nmyCDGBKInavdOK15jsl");
    expect(
      official({
        rawBody: Buffer.from('{"event_type":"ping","data":{"success":true}}'),
        headers: {
          "svix-id": "msg_loFOjxBNrRLzqYUf",
          "svix-timestamp": "1731705121",
          "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
        },
        now: new Date(1731705121 * 1000),
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });
  it("accepts any matching v1 signature, ignores unsupported versions and authenticates exact raw bytes", () => {
    const input = event("email.complained");
    expect(
      verify({
        ...input,
        headers: {
          ...input.headers,
          "svix-signature": `v2,nope v1,${"A".repeat(43)}= ${input.headers["svix-signature"]}`,
        },
      }).ok,
    ).toBe(true);
    expect(verify({ ...input, rawBody: Buffer.concat([input.rawBody, Buffer.from(" ")]) })).toEqual(
      { ok: false, reason: "unauthenticated" },
    );
    expect(verify({ ...input, headers: signed(input.rawBody, timestamp, "changed-id") })).toEqual({
      ok: true,
      ignored: false,
      facts: expect.any(Array),
    });
    expect(verify({ ...input, headers: { ...input.headers, "svix-id": "changed-id" } })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });
  it("checks the inclusive signed timestamp tolerance independently of event time", () => {
    const input = event("email.complained", undefined, "2021-02-24T12:00:00Z");
    for (const delta of [-300, 300])
      expect(verify({ ...input, headers: signed(input.rawBody, timestamp + delta) }).ok).toBe(true);
    for (const delta of [-301, 301])
      expect(verify({ ...input, headers: signed(input.rawBody, timestamp + delta) })).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
  });
  it("rejects missing/unsafe/multiple headers and verifies before parsing", () => {
    const input = event("email.complained");
    for (const name of ["svix-id", "svix-timestamp", "svix-signature"] as const) {
      expect(verify({ ...input, headers: { ...input.headers, [name]: undefined } })).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
      expect(
        verify({ ...input, headers: { ...input.headers, [name]: [input.headers[name]] } }),
      ).toEqual({ ok: false, reason: "unauthenticated" });
    }
    for (const headers of [
      { ...input.headers, "svix-id": "unsafe\r\nid" },
      { ...input.headers, "svix-id": "x".repeat(129) },
      { ...input.headers, "svix-timestamp": "1e9" },
      { ...input.headers, "svix-signature": "v2,unsupported" },
      { ...input.headers, "svix-signature": "v1,short" },
      { ...input.headers, "svix-signature": "x".repeat(4097) },
    ])
      expect(verify({ ...input, headers })).toEqual({ ok: false, reason: "unauthenticated" });
    const rawBody = Buffer.from("not JSON");
    expect(verify({ now, rawBody, headers: {} })).toEqual({ ok: false, reason: "unauthenticated" });
    expect(verify({ now, rawBody, headers: signed(rawBody) })).toEqual({
      ok: false,
      reason: "malformed",
    });
    const other = createResendWebhookVerifier(`whsec_${Buffer.alloc(24, 9).toString("base64")}`);
    expect(other(input)).toEqual({ ok: false, reason: "unauthenticated" });
  });
});

describe("Resend suppression fact allowlist", () => {
  it("maps permanent bounce, complaint and blocked events with normalized recipients", () => {
    const cases = [
      [
        "email.bounced",
        {
          to: ["Person@Example.Test"],
          bounce: { type: "Permanent", message: "ignored vendor text" },
        },
        "hard_bounce",
      ],
      ["email.complained", { to: ["Person@Example.Test"] }, "complaint"],
      ["email.suppressed", { to: ["Person@Example.Test"] }, "blocked"],
      ["suppression.added", { email: "Person@Example.Test" }, "blocked"],
    ] as const;
    for (const [type, data, reason] of cases) {
      const result = verify(event(type, data));
      expect(result).toEqual({
        ok: true,
        ignored: false,
        facts: [
          {
            eventKey: expect.stringMatching(/^msg_[A-Za-z0-9]+:[a-f0-9]{64}$/),
            recipient: "person@example.test",
            reason,
            eventAt: now,
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain("ignored vendor text");
    }
  });
  it("uses a stable per-recipient key across retries and changed recipient ordering", () => {
    const a = verify(event("email.complained", { to: ["a@example.test", "b@example.test"] }));
    const b = verify(event("email.complained", { to: ["b@example.test", "a@example.test"] }));
    if (!a.ok || !b.ok) throw new Error("expected facts");
    expect(a.facts[0]).toEqual(b.facts[1]);
    expect(a.facts[1]).toEqual(b.facts[0]);
    expect(a.facts[0]?.eventKey).not.toBe(a.facts[1]?.eventKey);
    expect(verify(event("email.complained", { to: ["a@example.test", "b@example.test"] }))).toEqual(
      a,
    );
  });
  it("ignores soft bounces, delivery, unsubscribe-removal and other irrelevant events", () => {
    for (const input of [
      event("email.bounced", { bounce: { type: "Transient" } }),
      event("suppression.removed"),
      event("email.delivered"),
      event("anything.else"),
    ]) {
      expect(verify(input)).toEqual({ ok: true, facts: [], ignored: true });
    }
  });
  it("rejects malformed recipients/event times and caps recipient count", () => {
    for (const input of [
      event("email.complained", { to: "person@example.test" }),
      event("email.complained", { to: [] }),
      event("email.complained", { to: Array.from({ length: 101 }, () => "person@example.test") }),
      event("email.complained", { to: ["person@example.test", "bad\r\naddress"] }),
      event("email.complained", undefined, "bad date"),
      event("email.complained", undefined, "2026-02-30T12:00:00Z"),
      event("suppression.added", { email: ["person@example.test"] }),
      event("email.bounced", { to: ["person@example.test"] }),
    ])
      expect(verify(input)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("Resend webhook-secret accessor", () => {
  it("treats blank as disabled and returns a canonical bounded signing secret", () => {
    for (const secret of [undefined, "", "  "])
      expect(readResendWebhookSecret({ RESEND_WEBHOOK_SECRET: secret })).toBeUndefined();
    expect(readResendWebhookSecret({ RESEND_WEBHOOK_SECRET: SECRET })).toBe(SECRET);
    for (const size of [16, 128]) {
      const secret = `whsec_${Buffer.alloc(size, 7).toString("base64")}`;
      expect(readResendWebhookSecret({ RESEND_WEBHOOK_SECRET: secret })).toBe(secret);
    }
  });
  it("fails invalid nonblank secrets without showing a value", () => {
    for (const secret of [
      "wrong",
      "whsec_????",
      "whsec_YQ==",
      `whsec_${Buffer.alloc(129).toString("base64")}`,
      `${SECRET} `,
      ` ${SECRET}`,
      `${SECRET}\n`,
      `whsec_${"A".repeat(30)}B=`,
    ]) {
      expect(() => readResendWebhookSecret({ RESEND_WEBHOOK_SECRET: secret })).toThrow(
        /^RESEND_WEBHOOK_SECRET must be /,
      );
    }
  });
});

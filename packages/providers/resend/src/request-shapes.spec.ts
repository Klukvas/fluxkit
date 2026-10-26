import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESEND_USER_AGENT } from "./config.js";
import { live, message, MESSAGE_ID, providerOn } from "./test-support/fixtures.js";
import {
  STUB_API_KEY,
  STUB_PERSONAL,
  startStubResend,
  type StubResend,
} from "./test-support/stub-resend.js";

/*
 * The exact request the plugin sends (plan section 2: R1 route and Bearer key, R2 body, R3 `reply_to` ASSUMED, R4
 * `Idempotency-Key`, R6 `User-Agent`). Pinned here so a change of shape is a decision, not an accident.
 */
describe("the request to POST /emails", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("is one POST to /emails with the Bearer key, User-Agent, Idempotency-Key and a JSON body", async () => {
    const { provider } = providerOn(stub);
    const result = await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    expect(result).toEqual({
      ok: true,
      value: { providerMessageId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(stub.requests).toHaveLength(1);
    const [request] = stub.requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/emails"); // no query: the key is never in the URL
    expect(request?.headers.authorization).toBe(`Bearer ${STUB_API_KEY}`);
    expect(request?.headers["user-agent"]).toBe(RESEND_USER_AGENT);
    expect(request?.headers["idempotency-key"]).toBe(MESSAGE_ID);
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers.accept).toBe("application/json");
    expect(request?.body).toEqual({
      from: '"Fluxkit Demo Shop" <shop@mail.example>',
      to: [STUB_PERSONAL.recipient],
      subject: STUB_PERSONAL.subject,
      html: "<p>Дякуємо за замовлення 7K3M-9QX2.</p>",
      text: "Дякуємо за замовлення 7K3M-9QX2.",
      reply_to: STUB_PERSONAL.replyTo, // R3: the assumed member name, unverified until S1
      tags: [{ name: "category", value: "order" }],
    });
    // Nothing else travels: no custom headers, cc or bcc (ADR 0031 decision 16), and the key is not in the body.
    expect(Object.keys(request?.body as object).sort()).toEqual(
      ["from", "html", "reply_to", "subject", "tags", "text", "to"].sort(),
    );
    expect(request?.rawBody).not.toContain(STUB_API_KEY);
    expect(request?.rawBody).not.toContain(STUB_API_KEY.slice(3, 15));
    // Only the expected request headers (Node adds the transport ones).
    const named = Object.keys(request?.headers ?? {}).filter(
      (name) =>
        ![
          "host",
          "connection",
          "content-length",
          "accept-encoding",
          "accept-language",
          "sec-fetch-mode",
        ].includes(name),
    );
    expect(named.sort()).toEqual(
      ["accept", "authorization", "content-type", "idempotency-key", "user-agent"].sort(),
    );
  });

  it("sends no reply_to without a reply-to address, and the recipient's display name when it has one", async () => {
    const { provider } = providerOn(stub);
    const withoutReplyTo = message({
      to: { address: STUB_PERSONAL.recipient, displayName: "Ярина" },
    });
    delete (withoutReplyTo as { replyTo?: unknown }).replyTo;
    await provider.send(withoutReplyTo, { idempotencyKey: MESSAGE_ID }, live());
    const body = stub.requests[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("reply_to");
    expect(body.to).toEqual([`"Ярина" <${STUB_PERSONAL.recipient}>`]);
  });

  it("sends the same bytes for every attempt of one message (Resend compares the body under one key, R4)", async () => {
    const { provider } = providerOn(stub);
    await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    await provider.send(message(), { idempotencyKey: MESSAGE_ID }, live());
    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[1]?.rawBody).toBe(stub.requests[0]?.rawBody);
    expect(stub.requests[1]?.headers["idempotency-key"]).toBe(MESSAGE_ID);
  });
});

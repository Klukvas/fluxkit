import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { live, message, MESSAGE_ID, providerOn } from "./test-support/fixtures.js";
import {
  STUB_API_KEY,
  STUB_PERSONAL,
  startStubBrevo,
  type StubBrevo,
} from "./test-support/stub-brevo.js";

describe("Brevo request shape", () => {
  let stub: StubBrevo;
  beforeEach(async () => {
    stub = await startStubBrevo();
  });
  afterEach(async () => {
    await stub?.close();
  });
  it("sends one POST, one recipient, inline parts and the UUID in JSON headers", async () => {
    const result = await providerOn(stub).provider.send(
      message(),
      { idempotencyKey: MESSAGE_ID },
      live(),
    );
    expect(result).toEqual({
      ok: true,
      value: { providerMessageId: "<1.Stub+ID@smtp-relay.mailin.fr>" },
    });
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0];
    expect(request).toMatchObject({ method: "POST", url: "/v3/smtp/email" });
    expect(request?.headers["api-key"]).toBe(STUB_API_KEY);
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.headers["idempotency-key"]).toBeUndefined();
    expect(request?.body).toEqual({
      sender: { email: "shop@mail.example", name: "Fluxkit Demo Shop" },
      to: [{ email: STUB_PERSONAL.recipient }],
      subject: STUB_PERSONAL.subject,
      htmlContent: message().html,
      textContent: message().text,
      replyTo: { email: STUB_PERSONAL.replyTo },
      tags: ["order"],
      headers: { idempotencyKey: MESSAGE_ID },
    });
    expect(request?.rawBody).not.toContain(STUB_API_KEY);
  });
  it("omits absent replyTo and forwards names without assembling SMTP headers", async () => {
    const without = { ...message() };
    delete (without as { replyTo?: unknown }).replyTo;
    await providerOn(stub).provider.send(
      { ...without, to: { address: STUB_PERSONAL.recipient, displayName: "Ярина" } },
      { idempotencyKey: MESSAGE_ID },
      live(),
    );
    expect(stub.requests[0]?.body).toMatchObject({
      to: [{ email: STUB_PERSONAL.recipient, name: "Ярина" }],
    });
    expect(stub.requests[0]?.body).not.toHaveProperty("replyTo");
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { live, message, MESSAGE_ID, providerOn } from "./test-support/fixtures.js";
import { STUB_PERSONAL, startStubResend, type StubResend } from "./test-support/stub-resend.js";

/*
 * Hostile values (ADR 0031 decision 16): the body travels as JSON, so whatever a subject or a body holds reaches Resend as
 * that exact string and cannot add a header or a recipient; what could (CR, LF, NUL or a second address in a header
 * value) is refused locally as `not_sent` before any request.
 */
describe("hostile values", () => {
  let stub: StubResend;

  beforeEach(async () => {
    stub = await startStubResend();
  });

  afterEach(async () => {
    await stub.close();
  });

  it("passes a hostile but header-safe subject and bodies through byte for byte, as one recipient", async () => {
    const subject = `"Order" <script>alert(1)</script> \\ Bcc: evil@example.com; ${"\u{1F4E6}"} it's`;
    const html = `<p>x</p>\r\nBcc: evil@example.com\r\nX-Injected: 1\r\n\r\n<img src=x onerror=alert(1)>"\u2028\u0000`;
    const text = "line 1\r\nBcc: evil@example.com\r\n\r\nline 2 \\\" '";
    const { provider } = providerOn(stub);
    const result = await provider.send(
      message({ subject, html, text }),
      { idempotencyKey: MESSAGE_ID },
      live(),
    );
    expect(result.ok).toBe(true);
    const body = stub.requests[0]?.body as Record<string, unknown>;
    expect(body.subject).toBe(subject);
    expect(body.html).toBe(html);
    expect(body.text).toBe(text);
    expect(body.to).toEqual([STUB_PERSONAL.recipient]);
    expect(body).not.toHaveProperty("headers");
    expect(body).not.toHaveProperty("bcc");
    expect(body).not.toHaveProperty("cc");
    // The request's own headers are the five the plugin sets, nothing from the message.
    const headers = stub.requests[0]?.headers ?? {};
    expect(headers).not.toHaveProperty("bcc");
    expect(headers).not.toHaveProperty("x-injected");
  });

  const refused: [string, Parameters<typeof message>[0], string][] = [
    ["a subject with CR LF", { subject: "Hi\r\nBcc: evil@example.com" }, "subject"],
    ["a subject with NUL", { subject: "Hi\u0000there" }, "subject"],
    [
      "a second recipient in the address",
      { to: { address: `${STUB_PERSONAL.recipient},evil@example.com`, displayName: null } },
      "to",
    ],
    [
      "a display name with a line break",
      { from: { address: "shop@mail.example", displayName: "Shop\r\nBcc: evil@example.com" } },
      "from",
    ],
    [
      "a display name with an angle bracket",
      { replyTo: { address: STUB_PERSONAL.replyTo, displayName: "x <evil@example.com>" } },
      "replyTo",
    ],
    ["an empty text part", { text: "  " }, "text"],
    ["a tag outside Resend's rule", { tags: { category: "order mails" } }, "tags.category"],
  ];
  for (const [name, overrides, path] of refused) {
    it(`refuses ${name} locally: not_sent and no request`, async () => {
      const { provider } = providerOn(stub);
      const result = await provider.send(
        message(overrides),
        { idempotencyKey: MESSAGE_ID },
        live(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("not_sent");
        expect(result.providerCodes[0]).toBe("invalid_message");
        expect(result.providerCodes.some((code) => code.startsWith(`${path}.`))).toBe(true);
        expect(result.providerCodes.join(" ")).not.toContain("evil");
      }
      expect(stub.requests).toHaveLength(0);
    });
  }

  it("refuses an idempotency key Resend would refuse (R4: 1 to 256 characters), with no request", async () => {
    const { provider } = providerOn(stub);
    for (const key of ["", "k".repeat(257), "has space", "ключ"]) {
      const result = await provider.send(message(), { idempotencyKey: key }, live());
      expect(result).toEqual({
        ok: false,
        reason: "not_sent",
        providerCodes: ["invalid_message", "idempotencyKey.invalid"],
      });
    }
    expect(stub.requests).toHaveLength(0);
    const longest = await provider.send(message(), { idempotencyKey: "k".repeat(256) }, live());
    expect(longest.ok).toBe(true);
  });
});

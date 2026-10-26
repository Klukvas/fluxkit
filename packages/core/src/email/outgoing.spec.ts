import { describe, expect, it } from "vitest";
import { validateOutgoingEmail } from "./outgoing.js";
import type { OutgoingEmail } from "./provider-port.js";

const KEY = "0b6f8d3e-1c2a-4d5e-9f10-a1b2c3d4e5f6";

const message: OutgoingEmail = {
  from: { address: "shop@mail.example.com", displayName: "Fluxkit Demo Shop" },
  replyTo: { address: "help@example.com", displayName: null },
  to: { address: "shopper@example.com", displayName: null },
  subject: "Order FK-12345 is paid",
  html: "<p>Order FK-12345 is paid</p>",
  text: "Order FK-12345 is paid",
  tags: { category: "order" },
};

describe("validateOutgoingEmail", () => {
  it("accepts a rendered, checked mail", () => {
    expect(validateOutgoingEmail(message, KEY)).toEqual([]);
    const withoutReplyTo: OutgoingEmail = {
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      tags: message.tags,
    };
    expect(validateOutgoingEmail(withoutReplyTo, KEY)).toEqual([]);
  });

  it("refuses a second recipient, header injection and a non-normalized address", () => {
    expect(
      validateOutgoingEmail(
        { ...message, to: { address: "a@b.test,c@d.test", displayName: null } },
        KEY,
      ),
    ).toEqual([{ path: "to", code: "invalid_format" }]);
    expect(
      validateOutgoingEmail(
        { ...message, to: { address: "a@b.test\r\nBcc: x@evil.test", displayName: null } },
        KEY,
      ),
    ).toEqual([{ path: "to", code: "forbidden_character" }]);
    expect(
      validateOutgoingEmail({ ...message, to: { address: "A@B.test", displayName: null } }, KEY),
    ).toEqual([{ path: "to", code: "not_normalized" }]);
    expect(
      validateOutgoingEmail(
        { ...message, from: { address: "shop@mail.example.com", displayName: "Shop\r\nBcc: x" } },
        KEY,
      ),
    ).toEqual([{ path: "from", code: "forbidden_character" }]);
    expect(
      validateOutgoingEmail(
        { ...message, from: { address: "shop@mail.example.com", displayName: " Shop " } },
        KEY,
      ),
    ).toEqual([{ path: "from", code: "not_normalized" }]);
  });

  it("refuses an unsafe subject, blank parts, a bad tag and a bad key, all at once", () => {
    expect(
      validateOutgoingEmail(
        {
          ...message,
          subject: "Paid\r\nBcc: x@evil.test",
          html: " ",
          text: "",
          tags: { category: "order.paid" },
        },
        "",
      ),
    ).toEqual([
      { path: "subject", code: "forbidden_character" },
      { path: "html", code: "empty" },
      { path: "text", code: "empty" },
      { path: "tags.category", code: "invalid" },
      { path: "idempotencyKey", code: "invalid" },
    ]);
    expect(validateOutgoingEmail(message, "a".repeat(257))).toEqual([
      { path: "idempotencyKey", code: "invalid" },
    ]);
    expect(validateOutgoingEmail(message, "key with spaces")).toEqual([
      { path: "idempotencyKey", code: "invalid" },
    ]);
    expect(validateOutgoingEmail(message, "a".repeat(256))).toEqual([]);
  });
});

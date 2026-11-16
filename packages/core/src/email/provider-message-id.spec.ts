import { describe, expect, it } from "vitest";
import { EMAIL_CODE_PATTERN, isEmailProviderMessageId } from "./limits.js";
import { isEmailProviderCapabilities } from "./provider-port.js";

describe("opaque provider message IDs", () => {
  it.each([
    "legacy_1.2:3-x",
    "x".repeat(64),
    "<ABC.1:+x-y@SMTP-relay.example>",
    `<${"a".repeat(251)}@b>`,
  ])("accepts %s verbatim", (id) => {
    expect(isEmailProviderMessageId(id)).toBe(true);
  });
  it.each([
    "",
    "x".repeat(65),
    "<a@b>\n",
    "<a@b>\r",
    "<a@b>\0",
    " <a@b>",
    "<a@b>,<c@d>",
    "<a@b@c>",
    "<@b>",
    "<a@>",
    "<a@b/c>",
    "<a@é>",
    `<${"a".repeat(252)}@b>`,
  ])("rejects %j", (id) => {
    expect(isEmailProviderMessageId(id)).toBe(false);
  });
  it("does not broaden error-code validation", () => {
    expect(EMAIL_CODE_PATTERN.test("<a@b>")).toBe(false);
  });
});

describe("provider replay capability validation", () => {
  it("retains absent-window behavior and accepts a bounded whole duration", () => {
    expect(isEmailProviderCapabilities({ idempotencyKeys: true, maxRecipients: 1 })).toBe(true);
    expect(
      isEmailProviderCapabilities({
        idempotencyKeys: true,
        maxRecipients: 1,
        idempotencyWindowSeconds: 1800,
      }),
    ).toBe(true);
  });
  it.each([null, "1800", 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    "refuses invalid window %s",
    (window) => {
      expect(
        isEmailProviderCapabilities({
          idempotencyKeys: true,
          maxRecipients: 1,
          idempotencyWindowSeconds: window,
        }),
      ).toBe(false);
    },
  );
});

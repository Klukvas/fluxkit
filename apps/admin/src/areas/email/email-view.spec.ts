import type { AdminEmailMessageStatus } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  ERROR_CODE_REASONS,
  MESSAGE_STATUSES,
  MESSAGE_STATUS_TONES,
  ageText,
  describeErrorCode,
  mailboxText,
  messageHref,
  previewLocale,
  statusLabelKey,
  templateHref,
} from "./email-view";

describe("status mapping", () => {
  it("lists the six statuses of the API in the order of a mail's life", () => {
    expect(MESSAGE_STATUSES).toEqual([
      "pending",
      "sending",
      "sent",
      "failed",
      "unknown",
      "cancelled",
    ]);
  });

  it("gives each status its tone (hand-written): sent is a success, failed a danger, pending and unknown a warning", () => {
    const expected: Record<AdminEmailMessageStatus, string> = {
      pending: "warning",
      sending: "neutral",
      sent: "success",
      failed: "danger",
      unknown: "warning",
      cancelled: "neutral",
    };
    expect(MESSAGE_STATUS_TONES).toEqual(expected);
  });

  it("names a label key per status", () => {
    for (const status of MESSAGE_STATUSES)
      expect(statusLabelKey(status)).toBe(`mail.status.${status}`);
  });
});

describe("describeErrorCode", () => {
  it("explains each known reason and keeps the whole stored code for support", () => {
    for (const reason of ERROR_CODE_REASONS) {
      expect(describeErrorCode(reason)).toEqual({ key: `mail.code.${reason}`, code: reason });
    }
  });

  it("follows the reason before the colon: rejected:validation_error is a rejection", () => {
    expect(describeErrorCode("rejected:validation_error")).toEqual({
      key: "mail.code.rejected",
      code: "rejected:validation_error",
    });
    expect(describeErrorCode("unavailable:timeout").key).toBe("mail.code.unavailable");
  });

  it("gives a code of a newer version the neutral text, never an invented explanation", () => {
    expect(describeErrorCode("brand_new").key).toBe("mail.code.unrecognized");
    expect(describeErrorCode("brand_new:x")).toEqual({
      key: "mail.code.unrecognized",
      code: "brand_new:x",
    });
  });
});

describe("ageText", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");
  it("reads minutes, hours and days in the locale", () => {
    expect(ageText("2026-10-26T11:55:00.000Z", now, "en")).toBe("5 minutes ago");
    expect(ageText("2026-10-26T09:00:00.000Z", now, "en")).toBe("3 hours ago");
    expect(ageText("2026-10-24T12:00:00.000Z", now, "en")).toBe("2 days ago");
  });
  it("reads a time in the future (clock skew) as now, never as a negative age", () => {
    expect(ageText("2026-10-26T12:05:00.000Z", now, "en")).toBe("this minute");
  });
  it("follows the locale", () => {
    expect(ageText("2026-10-26T11:55:00.000Z", now, "uk")).toMatch(/5 хвилин/);
  });
});

describe("mailboxText and links", () => {
  it("writes the name and the address, or the bare address", () => {
    expect(mailboxText({ address: "shop@example.com", displayName: "Shop" })).toBe(
      "Shop <shop@example.com>",
    );
    expect(mailboxText({ address: "shop@example.com", displayName: null })).toBe(
      "shop@example.com",
    );
    expect(mailboxText({ address: "shop@example.com", displayName: "" })).toBe("shop@example.com");
  });
  it("links a message by its id and a template by its key, with an optional language", () => {
    expect(messageHref("a b/c")).toBe("/email/messages/a%20b%2Fc");
    expect(templateHref("order.placed")).toBe("/email/templates/order.placed");
    expect(templateHref("order.placed", "uk")).toBe("/email/templates/order.placed?locale=uk");
  });
});

describe("previewLocale", () => {
  it("takes the requested language when the shop has it, else the interface language, else the first", () => {
    expect(previewLocale("en", "uk")).toBe("en");
    expect(previewLocale("fr", "en")).toBe("en");
    expect(previewLocale(null, "uk")).toBe("uk");
    expect(previewLocale(null, "de")).toBe("uk");
  });
});

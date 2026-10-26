import { describe, expect, it } from "vitest";
import { EMAIL_MAX_LENGTH } from "../auth/email.js";
import {
  formatMailbox,
  parseMailbox,
  validateDisplayName,
  validateEmailAddress,
} from "./address.js";
import { EMAIL_LIMITS } from "./limits.js";

describe("validateEmailAddress", () => {
  it("accepts and normalizes an ordinary address (trim, lower case), as the stored form", () => {
    expect(validateEmailAddress("  Shopper.One+tag@Example.COM ")).toEqual({
      ok: true,
      address: "shopper.one+tag@example.com",
    });
    expect(validateEmailAddress("o'brien@mail.example.ua")).toEqual({
      ok: true,
      address: "o'brien@mail.example.ua",
    });
    expect(validateEmailAddress("a@xn--80ak6aa92e.com")).toEqual({
      ok: true,
      address: "a@xn--80ak6aa92e.com",
    });
  });

  it.each([
    ["CR", "a@b.test\r"],
    ["LF", "a@b.test\nBcc: x@evil.test"],
    ["CRLF inside", "a\r\n@b.test"],
    ["NUL", "a\u0000@b.test"],
    ["tab", "a\t@b.test"],
    ["NEL", "a@b.test\u0085"],
    ["line separator", "a@b.test\u2028"],
    ["bidi override", "a\u202e@b.test"],
  ])("refuses %s before any trimming (no silent repair of a header value)", (_label, input) => {
    expect(validateEmailAddress(input)).toEqual({ ok: false, reason: "forbidden_character" });
  });

  it.each([
    ["comma (a second recipient)", "a@b.test,c@d.test"],
    ["comma in the local part", "a,b@b.test"],
    ["comma in the domain", "a@b,c.test"],
    ["semicolon", "a@b.test;c@d.test"],
    ["angle brackets in the local part", "<a>@b.test"],
    ["angle bracket in the domain", "a@b.test>"],
    ["quoted local part", '"a b"@b.test'],
    ["a space inside", "a b@b.test"],
    ["two at signs", "a@b@c.test"],
    ["no at sign", "a.b.test"],
    ["empty local part", "@b.test"],
    ["empty domain", "a@"],
    ["no dot in the domain", "a@localhost"],
    ["leading dot in the local part", ".a@b.test"],
    ["trailing dot in the local part", "a.@b.test"],
    ["two dots in the local part", "a..b@b.test"],
    ["leading dot in the domain", "a@.b.test"],
    ["trailing dot in the domain", "a@b.test."],
    ["empty label", "a@b..test"],
    ["label starting with a hyphen", "a@-b.test"],
    ["label ending with a hyphen", "a@b-.test"],
    ["underscore in the domain", "a@b_c.test"],
    ["parenthesis (a comment)", "a(x)@b.test"],
    ["backslash", "a\\b@b.test"],
    ["colon", "a:b@b.test"],
    ["square brackets (an IP literal)", "a@[127.0.0.1]"],
    ["numeric top-level label", "a@b.123"],
  ])("refuses %s", (_label, input) => {
    expect(validateEmailAddress(input)).toEqual({ ok: false, reason: "invalid_format" });
  });

  it.each([
    ["Cyrillic local part", "тест@example.com"],
    ["Cyrillic domain (not in punycode)", "a@приклад.укр"],
    ["fullwidth at sign", "a\uff20b.test"],
    ["zero-width space", "a\u200b@b.test"],
    ["no-break space", "a\u00a0@b.test"],
    ["Latin with a combining mark", "e\u0301@b.test"],
  ])(
    "refuses non-ASCII: %s (SMTPUTF8 support is not assumed; IDN domains go in punycode)",
    (_l, input) => {
      expect(validateEmailAddress(input)).toEqual({ ok: false, reason: "non_ascii" });
    },
  );

  it("checks the lengths: total EMAIL_MAX_LENGTH, local part 64, label 63", () => {
    const local64 = "a".repeat(EMAIL_LIMITS.localPartMaxLength);
    expect(validateEmailAddress(`${local64}@b.test`).ok).toBe(true);
    expect(validateEmailAddress(`${local64}a@b.test`)).toEqual({
      ok: false,
      reason: "invalid_format",
    });
    const label63 = "b".repeat(EMAIL_LIMITS.domainLabelMaxLength);
    expect(validateEmailAddress(`a@${label63}.test`).ok).toBe(true);
    expect(validateEmailAddress(`a@${label63}b.test`)).toEqual({
      ok: false,
      reason: "invalid_format",
    });
    const domain = `${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.${"f".repeat(60)}.test`;
    const atLimit = `${"a".repeat(EMAIL_MAX_LENGTH - domain.length - 1)}@${domain}`;
    expect(atLimit.length).toBe(EMAIL_MAX_LENGTH);
    expect(validateEmailAddress(atLimit).ok).toBe(true);
    expect(validateEmailAddress(`a${atLimit}`)).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses a huge input by its length", () => {
    expect(validateEmailAddress(`${"a".repeat(1_000_000)}@b.test`)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("refuses empty input and non-strings", () => {
    expect(validateEmailAddress("")).toEqual({ ok: false, reason: "empty" });
    expect(validateEmailAddress("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateEmailAddress(undefined)).toEqual({ ok: false, reason: "not_a_string" });
    expect(validateEmailAddress(["a@b.test"])).toEqual({ ok: false, reason: "not_a_string" });
  });
});

describe("validateDisplayName", () => {
  it("accepts names in any script and normalizes them to NFC, trimmed", () => {
    expect(validateDisplayName("Fluxkit Demo Shop")).toEqual({
      ok: true,
      displayName: "Fluxkit Demo Shop",
    });
    expect(validateDisplayName("  Крамниця Й\u0306 ")).toEqual({
      ok: true,
      displayName: "Крамниця Й\u0306".normalize("NFC"),
    });
    expect(validateDisplayName("O'Brien & Sons, Ltd.")).toEqual({
      ok: true,
      displayName: "O'Brien & Sons, Ltd.",
    });
  });

  it.each([
    ["CR", "Shop\r"],
    ["LF", "Shop\nBcc: x@evil.test"],
    ["NUL", "Shop\u0000"],
    ["tab", "Sh\top"],
    ["line separator", "Shop\u2028"],
    ["bidi override", "Shop\u202e"],
    ["less-than", "Shop <x@evil.test"],
    ["greater-than", "Shop>"],
    ["double quote", 'Shop "Best"'],
    ["backslash", "Shop\\"],
  ])("refuses %s", (_label, input) => {
    expect(validateDisplayName(input)).toEqual({ ok: false, reason: "forbidden_character" });
  });

  it("limits the length in code points after normalization", () => {
    const max = EMAIL_LIMITS.displayNameMaxLength;
    expect(validateDisplayName("я".repeat(max)).ok).toBe(true);
    // Decomposed input that composes to the limit is accepted (counted after NFC).
    expect(validateDisplayName("\u0419".repeat(max).normalize("NFD")).ok).toBe(true);
    expect(validateDisplayName("я".repeat(max + 1))).toEqual({ ok: false, reason: "too_long" });
    expect(validateDisplayName("я".repeat(1_000_000))).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses an empty name and a non-string", () => {
    expect(validateDisplayName(" ")).toEqual({ ok: false, reason: "empty" });
    expect(validateDisplayName(null)).toEqual({ ok: false, reason: "not_a_string" });
  });
});

describe("parseMailbox (EMAIL_FROM, EMAIL_REPLY_TO)", () => {
  it("parses a bare address", () => {
    expect(parseMailbox("shop@mail.example.com")).toEqual({
      ok: true,
      mailbox: { address: "shop@mail.example.com", displayName: null },
    });
  });

  it("parses `Display Name <address>`, with or without quotes around the name", () => {
    expect(parseMailbox("Fluxkit Demo Shop <shop@mail.example.com>")).toEqual({
      ok: true,
      mailbox: { address: "shop@mail.example.com", displayName: "Fluxkit Demo Shop" },
    });
    expect(parseMailbox('"Fluxkit Demo Shop" <Shop@Mail.Example.com>')).toEqual({
      ok: true,
      mailbox: { address: "shop@mail.example.com", displayName: "Fluxkit Demo Shop" },
    });
    expect(parseMailbox("<shop@mail.example.com>")).toEqual({
      ok: true,
      mailbox: { address: "shop@mail.example.com", displayName: null },
    });
  });

  it.each([
    [
      "CRLF header injection after the address",
      "Shop <a@b.test>\r\nBcc: x@evil.test",
      "forbidden_character",
    ],
    ["LF inside the name", "Sh\nop <a@b.test>", "forbidden_character"],
    ["NUL", "Shop <a@b.test>\u0000", "forbidden_character"],
    ["two addresses", "a@b.test, c@d.test", "invalid_address"],
    ["two angle groups", "A <a@b.test> B <c@d.test>", "invalid_format"],
    ["unclosed angle", "Shop <a@b.test", "invalid_format"],
    ["text after the angle", "Shop <a@b.test> x", "invalid_format"],
    ["angle inside the name", "Sh<op <a@b.test>", "invalid_format"],
    ["bad address inside", "Shop <a@@b.test>", "invalid_address"],
    ["quote inside the name", 'Sh"op <a@b.test>', "invalid_display_name"],
    ["unbalanced quote", '"Shop <a@b.test>', "invalid_display_name"],
    ["empty", "", "empty"],
  ])("refuses %s", (_label, input, reason) => {
    expect(parseMailbox(input)).toEqual({ ok: false, reason });
  });

  it("refuses more than 200 code points in total", () => {
    const name = "N".repeat(EMAIL_LIMITS.displayNameMaxLength);
    const address = `${"a".repeat(64)}@${"b".repeat(25)}.test`;
    const fits = `${name} <${address}>`;
    expect([...fits].length).toBeLessThanOrEqual(EMAIL_LIMITS.mailboxMaxLength);
    expect(parseMailbox(fits).ok).toBe(true);
    const over = `${name} <${"a".repeat(64)}@${"b".repeat(EMAIL_LIMITS.mailboxMaxLength)}.test>`;
    expect(parseMailbox(over)).toEqual({ ok: false, reason: "too_long" });
  });

  it("refuses a non-string", () => {
    expect(parseMailbox(undefined)).toEqual({ ok: false, reason: "not_a_string" });
  });
});

describe("formatMailbox", () => {
  it("writes a bare address, or the name quoted before the address in angle brackets", () => {
    expect(formatMailbox({ address: "a@b.test", displayName: null })).toBe("a@b.test");
    expect(formatMailbox({ address: "a@b.test", displayName: "Shop, Ltd." })).toBe(
      '"Shop, Ltd." <a@b.test>',
    );
    expect(formatMailbox({ address: "a@b.test", displayName: "Крамниця" })).toBe(
      '"Крамниця" <a@b.test>',
    );
  });

  it("round-trips through parseMailbox", () => {
    for (const mailbox of [
      { address: "a@b.test", displayName: null },
      { address: "shop@mail.example.com", displayName: "Fluxkit Demo Shop, Kyiv" },
    ]) {
      expect(parseMailbox(formatMailbox(mailbox))).toEqual({ ok: true, mailbox });
    }
  });

  it("throws for a mailbox that was not validated (a bug, never a header)", () => {
    expect(() =>
      formatMailbox({ address: "a@b.test\r\nBcc: x@evil.test", displayName: null }),
    ).toThrow(RangeError);
    expect(() =>
      formatMailbox({ address: "a@b.test", displayName: 'x" <evil@evil.test>' }),
    ).toThrow(RangeError);
    expect(() => formatMailbox({ address: "A@B.test", displayName: null })).toThrow(RangeError);
  });
});

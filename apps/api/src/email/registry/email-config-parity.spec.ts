import { describe, expect, it } from "vitest";
import { EMAIL_PROVIDER_CHOICES, parseMailboxVariable } from "@fluxkit/config";
import { EMAIL_PROVIDER_CODE_PATTERN, parseMailbox } from "@fluxkit/core";

/*
 * `@fluxkit/config` does not depend on `@fluxkit/core`, so it repeats the mailbox rules of `EMAIL_FROM` and
 * `EMAIL_REPLY_TO`. This spec runs both implementations on one corpus and fails when they disagree.
 */

const valid = [
  "shop@mail.example",
  "Shop@Mail.Example",
  "  shop@mail.example  ",
  "Fluxkit Demo Shop <shop@mail.example>",
  '"Fluxkit Demo Shop" <shop@mail.example>',
  "<shop@mail.example>",
  "Магазин <shop@mail.example>",
  "Shop <a.b+tag@sub.mail.example>",
  `${"x".repeat(64)}@mail.example`,
  `Shop <a@${"b".repeat(63)}.example>`,
  `${"S".repeat(100)} <shop@mail.example>`,
];

const invalid = [
  "",
  "   ",
  "shop",
  "shop@",
  "@mail.example",
  "shop@mail",
  "shop@mail.123",
  "a@b@mail.example",
  "a..b@mail.example",
  ".a@mail.example",
  "a b@mail.example",
  "shop@mail.example, other@mail.example",
  "shop@mail.example\r\nBcc: x@y.example",
  "Shop\nName <shop@mail.example>",
  "shop@mail.example\0",
  "Sh<op> <shop@mail.example>",
  'Sh"op <shop@mail.example>',
  "Sh\\op <shop@mail.example>",
  '"Shop <shop@mail.example>',
  'Shop" <shop@mail.example>',
  "Shop <shop@mail.example> <other@mail.example>",
  "Shop <shop@mail.example> trailing",
  "<shop@mail.example",
  "shop@mail.example>",
  "Shop >shop@mail.example<",
  "Shop ‮<shop@mail.example>",
  "Shop <shop@mail.example>",
  "Shop \ud800 <shop@mail.example>",
  "ша@mail.example",
  "shop@пошта.example",
  `${"x".repeat(65)}@mail.example`,
  `a@${"b".repeat(64)}.example`,
  `${"Shop ".repeat(40)}<shop@mail.example>`,
  `${"S".repeat(101)} <shop@mail.example>`,
  "a@-b.example",
  "a@b-.example",
  "a@b_c.example",
];

describe("EMAIL_FROM rules: config and core agree", () => {
  it.each([...valid, ...invalid])("%j", (input) => {
    const fromCore = parseMailbox(input);
    const fromConfig = parseMailboxVariable(input);
    if (fromCore.ok) {
      expect(fromConfig).toEqual(fromCore.mailbox);
    } else {
      expect(fromConfig).toBeUndefined();
    }
  });

  it("the corpus holds both outcomes", () => {
    expect(valid.every((input) => parseMailbox(input).ok)).toBe(true);
    expect(invalid.every((input) => !parseMailbox(input).ok)).toBe(true);
  });
});

describe("EMAIL_PROVIDER choices", () => {
  it("every provider choice but none is a valid provider code of core", () => {
    for (const choice of EMAIL_PROVIDER_CHOICES.filter((candidate) => candidate !== "none")) {
      expect(EMAIL_PROVIDER_CODE_PATTERN.test(choice)).toBe(true);
    }
  });
});

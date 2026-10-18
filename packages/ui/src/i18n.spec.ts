import { describe, expect, it } from "vitest";
import { createTranslator, defaultLocale, isLocale, messagePlaceholders } from "./i18n";

describe("i18n", () => {
  it("translates known keys", () => {
    expect(createTranslator({ hello: "Привіт" })("hello")).toBe("Привіт");
  });

  it("throws on a missing key instead of rendering nothing", () => {
    expect(() => createTranslator({})("nope")).toThrow(/Missing translation key "nope"/);
  });

  it("recognizes supported locales", () => {
    expect(isLocale("uk")).toBe(true);
    expect(isLocale("ru")).toBe(false);
    expect(defaultLocale).toBe("uk");
  });
});

describe("i18n interpolation", () => {
  const t = createTranslator({
    greeting: "Привіт, {name}!",
    twice: "{a} і {a}",
    plain: "Без параметрів",
  });

  it("replaces {name} placeholders", () => {
    expect(t("greeting", { name: "Оксана" })).toBe("Привіт, Оксана!");
    expect(t("twice", { a: 5 })).toBe("5 і 5");
  });

  it("leaves messages without placeholders unchanged, with or without values", () => {
    expect(t("plain")).toBe("Без параметрів");
    expect(t("plain", { unused: "x" })).toBe("Без параметрів");
  });

  it("throws on a missing value instead of rendering an empty string", () => {
    expect(() => t("greeting")).toThrow(/Missing value "name" for translation key "greeting"/);
    expect(() => t("greeting", { other: "x" })).toThrow(/Missing value "name"/);
  });

  it("does not treat a value that looks like a placeholder as a placeholder", () => {
    expect(t("greeting", { name: "{name}" })).toBe("Привіт, {name}!");
  });

  it("still throws on a missing key", () => {
    expect(() => t("nope", { name: "x" })).toThrow(/Missing translation key "nope"/);
  });

  it("lists the placeholders of a message", () => {
    expect(messagePlaceholders("{b} {a} {a}")).toEqual(["a", "b"]);
    expect(messagePlaceholders("none")).toEqual([]);
  });
});

describe("i18n plurals", () => {
  const uk = createTranslator(
    {
      "items.one": "{count} товар",
      "items.few": "{count} товари",
      "items.many": "{count} товарів",
      "items.other": "{count} товару",
      "left.one": "Залишився {count} {unit}",
      "left.few": "Залишилось {count} {unit}",
      "left.many": "Залишилось {count} {unit}",
      "left.other": "Залишилось {count} {unit}",
    },
    "uk",
  );
  const en = createTranslator(
    { "items.one": "{count} item", "items.other": "{count} items" },
    "en",
  );

  const ukCases: [number, string][] = [
    [0, "0 товарів"],
    [1, "1 товар"],
    [2, "2 товари"],
    [5, "5 товарів"],
    [11, "11 товарів"],
    [12, "12 товарів"],
    [21, "21 товар"],
    [22, "22 товари"],
    [25, "25 товарів"],
    [0.1, "0,1 товару"],
  ];
  for (const [count, expected] of ukCases) {
    it(`picks the Ukrainian form for ${count}`, () => {
      expect(uk.plural("items", count)).toBe(expected);
    });
  }

  it("picks the English forms", () => {
    expect(en.plural("items", 1)).toBe("1 item");
    expect(en.plural("items", 0)).toBe("0 items");
    expect(en.plural("items", 2)).toBe("2 items");
  });

  it("formats the count for the locale and still accepts other values", () => {
    expect(uk.plural("items", 1000)).toBe("1\u00a0000 товарів");
    expect(uk.plural("left", 3, { unit: "шт." })).toBe("Залишилось 3 шт.");
  });

  it("throws when the form for the count is missing, no silent fallback", () => {
    expect(() => en.plural("items", 1.5)).not.toThrow();
    const partial = createTranslator({ "x.one": "{count}" }, "en");
    expect(() => partial.plural("x", 2)).toThrow(/Missing translation key "x.other"/);
  });

  it("throws on a missing placeholder value inside a plural form", () => {
    expect(() => uk.plural("left", 3)).toThrow(/Missing value "unit"/);
  });

  it("throws when plural is used without a locale", () => {
    const noLocale = createTranslator({ "x.other": "{count}" });
    expect(() => noLocale.plural("x", 2)).toThrow(/locale/);
  });

  it("rejects a count that is not a finite number", () => {
    expect(() => uk.plural("items", Number.NaN)).toThrow(/finite/);
  });
});

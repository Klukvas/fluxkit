import { describe, expect, it } from "vitest";
import {
  checkBannerContent,
  checkBannerCount,
  checkBannerImageLocales,
  checkBannerOrder,
  resolveBannerPicture,
} from "./banner-content.js";
import { BANNER_LIMITS, MAX_STORED_BANNERS } from "./limits.js";

const LOCALES = { defaultLocale: "uk", locales: ["uk", "en"] } as const;

describe("checkBannerContent, layout card", () => {
  const card = { layout: "card" as const, title: { uk: "Розпродаж" }, text: null, imageAlt: null };

  it("accepts a title in the default locale, without text or alt", () => {
    expect(checkBannerContent(card, LOCALES)).toEqual([]);
  });

  it("accepts every optional text in both locales", () => {
    expect(
      checkBannerContent(
        {
          layout: "card",
          title: { uk: "Розпродаж", en: "Sale" },
          text: { uk: "Знижки", en: "Discounts" },
          imageAlt: { uk: "Взуття", en: "Shoes" },
        },
        LOCALES,
      ),
    ).toEqual([]);
  });

  it("requires a title in the default locale", () => {
    expect(checkBannerContent({ ...card, title: null }, LOCALES)).toEqual([
      { path: "title", code: "required" },
    ]);
    expect(checkBannerContent({ ...card, title: {} }, LOCALES)).toEqual([
      { path: "title", code: "required" },
    ]);
    expect(checkBannerContent({ ...card, title: { en: "Sale" } }, LOCALES)).toEqual([
      { path: "title.uk", code: "default_locale_missing" },
    ]);
  });

  it("limits the title to 1..80, the text to 200 and the alt to 150 characters (code points)", () => {
    expect(BANNER_LIMITS).toMatchObject({
      titleMaxLength: 80,
      textMaxLength: 200,
      imageAltMaxLength: 150,
    });
    const atLimit = {
      layout: "card" as const,
      title: { uk: "я".repeat(80) },
      text: { uk: "😀".repeat(200) },
      imageAlt: { uk: "a".repeat(150) },
    };
    expect(checkBannerContent(atLimit, LOCALES)).toEqual([]);
    expect(
      checkBannerContent(
        {
          layout: "card",
          title: { uk: "я".repeat(81) },
          text: { uk: "😀".repeat(201) },
          imageAlt: { uk: "a".repeat(151) },
        },
        LOCALES,
      ),
    ).toEqual([
      { path: "title.uk", code: "too_long", limit: 80 },
      { path: "text.uk", code: "too_long", limit: 200 },
      { path: "imageAlt.uk", code: "too_long", limit: 150 },
    ]);
    expect(checkBannerContent({ ...card, title: { uk: "   " } }, LOCALES)).toEqual([
      { path: "title.uk", code: "empty" },
    ]);
  });

  it("refuses locales outside the content locales and unsafe characters", () => {
    expect(
      checkBannerContent(
        { ...card, text: { uk: "x", pl: "y" }, imageAlt: { uk: "a\u0000" } },
        LOCALES,
      ),
    ).toEqual([
      { path: "text.pl", code: "locale_not_allowed" },
      { path: "imageAlt.uk", code: "invalid_characters" },
    ]);
  });

  it("needs the default locale in an optional text that is given", () => {
    expect(checkBannerContent({ ...card, text: { en: "Only English" } }, LOCALES)).toEqual([
      { path: "text.uk", code: "default_locale_missing" },
    ]);
  });
});

describe("checkBannerContent, layout image", () => {
  const image = { layout: "image" as const, title: null, text: null, imageAlt: { uk: "Опис" } };

  it("accepts the picture with its description in the default locale", () => {
    expect(checkBannerContent(image, LOCALES)).toEqual([]);
  });

  it("requires the description (it is the link's accessible name)", () => {
    expect(checkBannerContent({ ...image, imageAlt: null }, LOCALES)).toEqual([
      { path: "imageAlt", code: "required" },
    ]);
    expect(checkBannerContent({ ...image, imageAlt: { en: "Only English" } }, LOCALES)).toEqual([
      { path: "imageAlt.uk", code: "default_locale_missing" },
    ]);
  });

  it("refuses a title or a text: they are not shown for this layout", () => {
    expect(
      checkBannerContent({ ...image, title: { uk: "Розпродаж" }, text: { uk: "x" } }, LOCALES),
    ).toEqual([
      { path: "title", code: "not_allowed_for_layout" },
      { path: "text", code: "not_allowed_for_layout" },
    ]);
  });

  it("treats an empty map like no text", () => {
    expect(checkBannerContent({ ...image, title: {}, text: {} }, LOCALES)).toEqual([]);
  });
});

describe("checkBannerImageLocales", () => {
  it("accepts content locales, each once, the default locale included", () => {
    expect(checkBannerImageLocales([], LOCALES.locales)).toEqual([]);
    expect(checkBannerImageLocales(["en", "uk"], LOCALES.locales)).toEqual([]);
  });

  it("refuses an unknown locale and a repeated one, with the index of the entry", () => {
    expect(checkBannerImageLocales(["en", "pl", "en"], LOCALES.locales)).toEqual([
      { path: "images.1.locale", code: "locale_not_allowed" },
      { path: "images.2.locale", code: "duplicate" },
    ]);
  });
});

describe("resolveBannerPicture", () => {
  const pictures = new Map([["en", "english.png"]]);

  it("takes the picture of the requested locale", () => {
    expect(resolveBannerPicture("default.png", pictures, "en")).toBe("english.png");
  });

  it("falls back to the default picture for a locale without its own", () => {
    expect(resolveBannerPicture("default.png", pictures, "uk")).toBe("default.png");
    expect(resolveBannerPicture("default.png", new Map(), "en")).toBe("default.png");
  });

  it("uses the default locale's own picture only for that locale, never as a fallback", () => {
    const withUk = new Map([["uk", "ukrainian.png"]]);
    expect(resolveBannerPicture("default.png", withUk, "uk")).toBe("ukrainian.png");
    expect(resolveBannerPicture("default.png", withUk, "en")).toBe("default.png");
  });
});

describe("checkBannerOrder", () => {
  const current = ["a", "b", "c"];

  it("accepts any permutation of exactly the current set", () => {
    expect(checkBannerOrder(current, ["c", "a", "b"])).toEqual({ ok: true });
    expect(checkBannerOrder([], [])).toEqual({ ok: true });
  });

  it("refuses a missing, an unknown or a repeated id", () => {
    for (const requested of [
      ["a", "b"],
      ["a", "b", "c", "d"],
      ["a", "b", "d"],
      ["a", "a", "b", "c"],
      ["a", "a", "b"],
    ]) {
      expect(checkBannerOrder(current, requested), requested.join(",")).toEqual({
        ok: false,
        reason: "order_mismatch",
      });
    }
  });
});

describe("checkBannerCount", () => {
  it(`allows a new banner while fewer than ${MAX_STORED_BANNERS} are stored`, () => {
    expect(MAX_STORED_BANNERS).toBe(50);
    expect(checkBannerCount(0)).toEqual({ ok: true });
    expect(checkBannerCount(49)).toEqual({ ok: true });
  });

  it("refuses the 51st", () => {
    expect(checkBannerCount(50)).toEqual({ ok: false, reason: "too_many_banners" });
    expect(checkBannerCount(51)).toEqual({ ok: false, reason: "too_many_banners" });
  });
});

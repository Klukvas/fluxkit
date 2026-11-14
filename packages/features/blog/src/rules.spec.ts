import { describe, expect, it } from "vitest";
import {
  BLOG_LIMITS,
  checkPublishedAt,
  isPublicPost,
  missingTranslations,
  pageOffset,
  postState,
} from "./rules.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");
const LOCALES = ["uk", "en"] as const;

describe("the public-post predicate (plan section 5: status published and published_at <= now)", () => {
  it("is public at the exact instant of publishedAt", () => {
    expect(isPublicPost({ status: "published", publishedAt: new Date(NOW) }, NOW)).toBe(true);
  });

  it("is public after publishedAt and not one millisecond before it (scheduled)", () => {
    expect(
      isPublicPost({ status: "published", publishedAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe(true);
    expect(
      isPublicPost({ status: "published", publishedAt: new Date(NOW.getTime() + 1) }, NOW),
    ).toBe(false);
  });

  it("is never public as a draft, whatever its date", () => {
    expect(isPublicPost({ status: "draft", publishedAt: new Date("2001-01-01") }, NOW)).toBe(false);
    expect(isPublicPost({ status: "draft", publishedAt: null }, NOW)).toBe(false);
  });

  it("is not public for a published row without a date (the database check forbids it)", () => {
    expect(isPublicPost({ status: "published", publishedAt: null }, NOW)).toBe(false);
  });
});

describe("the admin state of a post", () => {
  it("is draft, scheduled or published", () => {
    expect(postState({ status: "draft", publishedAt: new Date("2001-01-01") }, NOW)).toBe("draft");
    expect(
      postState({ status: "published", publishedAt: new Date(NOW.getTime() + 60_000) }, NOW),
    ).toBe("scheduled");
    expect(postState({ status: "published", publishedAt: new Date(NOW) }, NOW)).toBe("published");
  });
});

describe("the publish rule: title and body in every content locale (owner's answer 6 (a))", () => {
  it("accepts a post with both texts in every locale", () => {
    expect(
      missingTranslations(
        { title: { uk: "Заголовок", en: "Title" }, body: { uk: "Текст", en: "Text" } },
        LOCALES,
      ),
    ).toEqual([]);
  });

  it("names every missing locale and field, title before body, in the order of the locales", () => {
    expect(missingTranslations({ title: { uk: "Заголовок" }, body: {} }, LOCALES)).toEqual([
      { path: "title.en", code: "translation_missing" },
      { path: "body.uk", code: "translation_missing" },
      { path: "body.en", code: "translation_missing" },
    ]);
  });

  it("counts a blank text as missing", () => {
    expect(
      missingTranslations(
        { title: { uk: "Заголовок", en: " \n" }, body: { uk: "Текст", en: "\t" } },
        LOCALES,
      ),
    ).toEqual([
      { path: "title.en", code: "translation_missing" },
      { path: "body.en", code: "translation_missing" },
    ]);
  });

  it("ignores a text in a locale that is no longer configured", () => {
    expect(
      missingTranslations({ title: { uk: "A", fr: "B" }, body: { uk: "C", fr: "D" } }, ["uk"]),
    ).toEqual([]);
  });

  it("does not read inherited keys as translations", () => {
    const title = Object.create({ en: "inherited" }) as Record<string, string>;
    title["uk"] = "Заголовок";
    expect(missingTranslations({ title, body: { uk: "x", en: "y" } }, LOCALES)).toEqual([
      { path: "title.en", code: "translation_missing" },
    ]);
  });
});

describe("the publish date range [2000-01-01, 2200-01-01)", () => {
  it("accepts the lower bound and refuses the upper one", () => {
    expect(checkPublishedAt(new Date("2000-01-01T00:00:00.000Z"))).toBe(true);
    expect(checkPublishedAt(new Date("2199-12-31T23:59:59.999Z"))).toBe(true);
    expect(checkPublishedAt(new Date("2200-01-01T00:00:00.000Z"))).toBe(false);
    expect(checkPublishedAt(new Date("1999-12-31T23:59:59.999Z"))).toBe(false);
  });
});

describe("page offsets within the catalog offset cap", () => {
  it("turns a page into an offset", () => {
    expect(pageOffset(1, 12)).toBe(0);
    expect(pageOffset(3, 12)).toBe(24);
  });

  it("refuses a page past the cap and accepts the last one inside it", () => {
    const limit = 50;
    const lastPage = BLOG_LIMITS.maxOffset / limit + 1;
    expect(pageOffset(lastPage, limit)).toBe(BLOG_LIMITS.maxOffset);
    expect(pageOffset(lastPage + 1, limit)).toBeUndefined();
  });
});

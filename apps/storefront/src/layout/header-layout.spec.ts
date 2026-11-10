import { describe, expect, it } from "vitest";
import { headerConfig } from "../config/header";
import { messagesByLocale } from "../messages";
import { sentinelTranslator } from "../components/test-helpers";
import {
  HEADER_CATEGORY_LIMIT_MAX,
  headerConfigProblems,
  headerView,
  type HeaderConfig,
} from "./header-layout";

const t = sentinelTranslator();
const keysOf = (locale: "uk" | "en") => new Set(Object.keys(messagesByLocale[locale]));
const categories = [
  { slug: "shoes", name: "Shoes" },
  { slug: "a b/c", name: "Odd" },
  { slug: "hats", name: "Hats" },
];
const base: HeaderConfig = {
  blocks: ["menu", "logo", "navigation", "search", "controls"],
  controls: ["language", "cart", "account"],
  navigation: { categoryLimit: 2, links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
};

describe("the header config in config/header.ts", () => {
  // Runs on the template's file and, in the fork run (`vitest.brand-fork.config.ts`), on a filled fork config.
  it("has no problems in either language", () => {
    expect(headerConfigProblems(headerConfig, keysOf("uk"))).toEqual([]);
    expect(headerConfigProblems(headerConfig, keysOf("en"))).toEqual([]);
  });
});

describe("headerView", () => {
  it("keeps the configured block order and resolves the links: categories (limited, slug encoded) first, then the links", () => {
    const view = headerView(base, { locale: "uk", t, categories, searchEnabled: true });
    expect(view.map((block) => block.kind)).toEqual([
      "menu",
      "logo",
      "navigation",
      "search",
      "controls",
    ]);
    const links = [
      { key: "c:shoes", href: "/uk/c/shoes", label: "Shoes" },
      { key: "c:a b/c", href: "/uk/c/a%20b%2Fc", label: "Odd" },
      { key: "/catalog", href: "/uk/catalog", label: "§nav.catalog" },
    ];
    expect(view[0]).toEqual({ kind: "menu", links });
    expect(view[2]).toEqual({ kind: "navigation", links });
    expect(view[4]).toEqual({ kind: "controls", controls: ["language", "cart", "account"] });
  });

  it("follows another order, leaves out blocks that are not listed, and orders the controls", () => {
    const view = headerView(
      { ...base, blocks: ["logo", "controls", "search"], controls: ["cart", "language"] },
      { locale: "en", t, categories, searchEnabled: true },
    );
    expect(view).toEqual([
      { kind: "logo" },
      { kind: "controls", controls: ["cart", "language"] },
      { kind: "search" },
    ]);
  });

  it("drops the search block when the shop has no search, and a control group with no controls", () => {
    const view = headerView(
      { ...base, controls: [] },
      { locale: "en", t, categories, searchEnabled: false },
    );
    expect(view.map((block) => block.kind)).toEqual(["menu", "logo", "navigation"]);
  });

  it("shows only the configured links when the categories could not be read, and no empty navigation", () => {
    const degraded = headerView(base, { locale: "en", t, categories: null, searchEnabled: false });
    expect(degraded[0]).toEqual({
      kind: "menu",
      links: [{ key: "/catalog", href: "/en/catalog", label: "§nav.catalog" }],
    });
    const nothing = headerView(
      { ...base, navigation: { categoryLimit: 0, links: [] } },
      { locale: "en", t, categories, searchEnabled: false },
    );
    expect(nothing.map((block) => block.kind)).toEqual(["logo", "controls"]);
  });
});

describe("headerConfigProblems", () => {
  const problems = (config: HeaderConfig) => headerConfigProblems(config, keysOf("en"));

  it("accepts the reference config", () => {
    expect(problems(base)).toEqual([]);
  });

  it("refuses a block or control listed twice", () => {
    expect(problems({ ...base, blocks: ["logo", "logo"] })).toEqual([
      'header block "logo" is listed more than once',
    ]);
    expect(problems({ ...base, controls: ["cart", "cart"] })).toEqual([
      'header control "cart" is listed more than once',
    ]);
  });

  it("refuses the menu without the inline navigation and the other way round (one breakpoint would have none)", () => {
    expect(problems({ ...base, blocks: ["menu", "logo", "controls"] })).toEqual([
      'header blocks "menu" and "navigation" go together: the menu is the navigation below `xl`, the inline list from `xl`',
    ]);
    expect(problems({ ...base, blocks: ["logo", "navigation", "controls"] })).toHaveLength(1);
    expect(problems({ ...base, blocks: ["logo", "controls"] })).toEqual([]);
  });

  it("refuses a category limit that is not a whole number from 0 to the maximum", () => {
    for (const categoryLimit of [-1, 1.5, HEADER_CATEGORY_LIMIT_MAX + 1, Number.NaN]) {
      expect(problems({ ...base, navigation: { ...base.navigation, categoryLimit } })).toEqual([
        `header categoryLimit must be a whole number from 0 to ${String(HEADER_CATEGORY_LIMIT_MAX)}`,
      ]);
    }
    expect(problems({ ...base, navigation: { ...base.navigation, categoryLimit: 0 } })).toEqual([]);
  });

  it("refuses a link with an unknown message key, a path that is not a plain storefront path, or a repeated path", () => {
    const withLinks = (links: HeaderConfig["navigation"]["links"]) =>
      problems({ ...base, navigation: { categoryLimit: 6, links } });
    expect(withLinks([{ labelKey: "nav.nope", href: "/catalog" }])).toEqual([
      'header link "/catalog": message key "nav.nope" does not exist',
    ]);
    expect(withLinks([{ labelKey: "nav.catalog", href: "https://example.com" }])).toEqual([
      'header link "https://example.com" is not a plain storefront path',
    ]);
    expect(
      withLinks([
        { labelKey: "nav.catalog", href: "/catalog" },
        { labelKey: "nav.catalog", href: "/catalog" },
      ]),
    ).toEqual(['header link "/catalog" is listed more than once']);
  });
});

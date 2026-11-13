import { describe, expect, it } from "vitest";
import { headerConfig } from "../config/header";
import { messagesByLocale } from "../messages";
import { sentinelTranslator } from "../components/test-helpers";
import {
  HEADER_CATEGORY_CHILDREN_MAX,
  HEADER_CATEGORY_LIMIT_MAX,
  assertHeaderConfig,
  headerConfigProblems,
  headerHasThemeControl,
  headerView,
  menuPanelAlign,
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
    const view = headerView(base, {
      locale: "uk",
      t,
      categories,
      searchEnabled: true,
      showThemeSwitch: true,
    });
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
    expect(view[0]).toEqual({ kind: "menu", links, align: "start", withTheme: false });
    expect(view[2]).toEqual({ kind: "navigation", links });
    expect(view[4]).toEqual({
      kind: "controls",
      controls: ["language", "cart", "account"],
      themeInMenu: false,
    });
  });

  it("follows another order, leaves out blocks that are not listed, and orders the controls", () => {
    const view = headerView(
      { ...base, blocks: ["search", "logo", "controls"], controls: ["cart", "language"] },
      { locale: "en", t, categories, searchEnabled: true, showThemeSwitch: true },
    );
    expect(view).toEqual([
      { kind: "search" },
      { kind: "logo" },
      { kind: "controls", controls: ["cart", "language"], themeInMenu: false },
    ]);
  });

  it("drops the search block when the shop has no search", () => {
    const view = headerView(base, {
      locale: "en",
      t,
      categories,
      searchEnabled: false,
      showThemeSwitch: true,
    });
    expect(view.map((block) => block.kind)).toEqual(["menu", "logo", "navigation", "controls"]);
  });

  it("opens the menu's panel towards the end when the menu is the first block on a phone, towards the start when it is the last", () => {
    const align = (blocks: HeaderConfig["blocks"]) =>
      headerView(
        { ...base, blocks, controls: blocks.includes("controls") ? base.controls : [] },
        { locale: "en", t, categories, searchEnabled: true, showThemeSwitch: true },
      ).find((block) => block.kind === "menu");
    // Shape 1: nothing but `navigation` (hidden on a phone) before the menu, the menu before the logo.
    expect(align(["menu", "logo", "navigation", "search", "controls"])).toMatchObject({
      align: "start",
    });
    expect(align(["navigation", "menu", "search", "logo", "controls"])).toMatchObject({
      align: "start",
    });
    // Shape 2: the menu after the logo, nothing but `navigation` after it, no controls.
    expect(align(["logo", "search", "menu", "navigation"])).toMatchObject({ align: "end" });
    expect(align(["search", "logo", "navigation", "menu"])).toMatchObject({ align: "end" });
    expect(menuPanelAlign(base)).toBe("start");
  });

  it("throws on a structural problem at render, so a fork that skipped the tests fails loudly", () => {
    expect(() =>
      headerView(
        { ...base, blocks: ["controls", "logo"] },
        { locale: "en", t, categories, searchEnabled: true, showThemeSwitch: true },
      ),
    ).toThrow(/config\/header\.ts is invalid: header block "controls" must be the last block/);
    expect(() => assertHeaderConfig(base)).not.toThrow();
  });

  it("shows only the configured links when the categories could not be read, and no empty navigation", () => {
    const degraded = headerView(base, {
      locale: "en",
      t,
      categories: null,
      searchEnabled: false,
      showThemeSwitch: true,
    });
    expect(degraded[0]).toEqual({
      kind: "menu",
      links: [{ key: "/catalog", href: "/en/catalog", label: "§nav.catalog" }],
      align: "start",
      withTheme: false,
    });
    const nothing = headerView(
      { ...base, navigation: { categoryLimit: 0, links: [] } },
      { locale: "en", t, categories, searchEnabled: false, showThemeSwitch: true },
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

describe("headerConfigProblems: required and supported shapes", () => {
  const problems = (config: HeaderConfig) => headerConfigProblems(config, keysOf("en"));

  it("refuses an empty block list and a header without the logo", () => {
    expect(problems({ ...base, blocks: [] })).toEqual([
      "header lists no blocks",
      'header block "logo" is required (the link to the home page)',
    ]);
    expect(problems({ ...base, blocks: ["menu", "navigation", "controls"] })).toEqual([
      'header block "logo" is required (the link to the home page)',
    ]);
  });

  it("refuses the controls block anywhere but last, and listed with no controls", () => {
    expect(problems({ ...base, blocks: ["controls", "logo"] })).toEqual([
      'header block "controls" must be the last block (the row pushes it to the end and its dropdowns open towards the start)',
    ]);
    expect(problems({ ...base, controls: [] })).toEqual([
      'header block "controls" is listed but `controls` is empty: leave the block out instead',
    ]);
    expect(problems({ ...base, blocks: ["logo", "search"], controls: [] })).toEqual([]);
  });

  it("checks message keys only when it gets them (at render the translator throws on an unknown key)", () => {
    const unknownKey: HeaderConfig = {
      ...base,
      navigation: { categoryLimit: 1, links: [{ labelKey: "nav.nope", href: "/catalog" }] },
    };
    expect(headerConfigProblems(unknownKey, null)).toEqual([]);
    expect(problems(unknownKey)).toHaveLength(1);
  });
});

describe("headerConfigProblems: the menu's place (browser-measured shapes only)", () => {
  const menuProblem =
    'header block "menu" must be the first block shown on a phone (before "logo", preceded by nothing but "navigation") or the last one (after "logo", followed by nothing but "navigation", with no "controls"): elsewhere its dropdown opens past the edge of a phone screen';
  const check = (blocks: HeaderConfig["blocks"]) =>
    headerConfigProblems(
      { ...base, blocks, controls: blocks.includes("controls") ? base.controls : [] },
      keysOf("en"),
    );

  it("accepts the two shapes, the default included", () => {
    for (const blocks of [
      ["menu", "logo", "navigation", "search", "controls"],
      ["menu", "search", "logo", "navigation", "controls"],
      ["navigation", "menu", "logo"],
      ["logo", "menu", "navigation"],
      ["search", "logo", "navigation", "menu"],
      ["logo", "search", "controls"],
    ] as HeaderConfig["blocks"][]) {
      expect(check(blocks), blocks.join()).toEqual([]);
    }
  });

  it("refuses every other place of the menu (measured past the screen edge, or as close to it)", () => {
    for (const blocks of [
      // after the logo with controls after it (a 3-control row put the panel 12 px past the start edge at 320 and 360 px)
      ["logo", "navigation", "search", "menu", "controls"],
      ["logo", "menu", "navigation", "search", "controls"],
      // after the logo with the search icon after it
      ["logo", "menu", "navigation", "search"],
      // before the logo but after the search icon (52 px in: a long category name crossed the end edge at 360 px)
      ["search", "menu", "logo", "navigation", "controls"],
    ] as HeaderConfig["blocks"][]) {
      expect(check(blocks), blocks.join()).toEqual([menuProblem]);
    }
  });
});

describe("headerView: the picker display (round 4)", () => {
  const picker: HeaderConfig = {
    ...base,
    navigation: { ...base.navigation, display: "picker" },
  };
  const tree = [
    {
      slug: "shoes",
      name: "Shoes",
      children: Array.from({ length: HEADER_CATEGORY_CHILDREN_MAX + 2 }, (_, index) => ({
        slug: `shoes-${String(index)}`,
        name: `Shoes ${String(index)}`,
      })),
    },
    { slug: "hats", name: "Hats" },
    { slug: "bags", name: "Bags", children: [] },
  ];
  const input = { locale: "uk", t, searchEnabled: true, showThemeSwitch: true } as const;

  it("renders ONE disclosure in the menu's place with the categories and their children, then the links, and no inline row", () => {
    const view = headerView(picker, { ...input, categories: tree });
    expect(view.map((block) => block.kind)).toEqual(["picker", "logo", "search", "controls"]);
    const block = view[0];
    if (block?.kind !== "picker") throw new Error("no picker");
    // `categoryLimit` 2 of `base`: the third top-level category is left out.
    expect(block.categories.map((category) => category.key)).toEqual(["c:shoes", "c:hats"]);
    expect(block.categories[0]?.children).toHaveLength(HEADER_CATEGORY_CHILDREN_MAX);
    expect(block.categories[0]?.children[0]).toEqual({
      key: "c:shoes-0",
      href: "/uk/c/shoes-0",
      label: "Shoes 0",
    });
    expect(block.categories[1]?.children).toEqual([]);
    expect(block.links).toEqual([{ key: "/catalog", href: "/uk/catalog", label: "§nav.catalog" }]);
    expect(block).toMatchObject({ align: "start", withTheme: false });
  });

  it("keeps the configured links when the categories could not be read, and leaves the picker out with no link at all", () => {
    const degraded = headerView(picker, { ...input, categories: null });
    expect(degraded[0]).toMatchObject({ kind: "picker", categories: [] });
    const nothing = headerView(
      { ...picker, navigation: { display: "picker", categoryLimit: 0, links: [] } },
      { ...input, categories: tree },
    );
    expect(nothing.map((block) => block.kind)).toEqual(["logo", "search", "controls"]);
  });

  it("is the row display when `display` is left out (existing forks keep their header)", () => {
    const view = headerView(base, { ...input, categories: tree });
    expect(view.map((block) => block.kind)).toContain("navigation");
    expect(view[0]?.kind).toBe("menu");
  });
});

describe("headerView: the theme control (round 4)", () => {
  const withTheme: HeaderConfig = { ...base, controls: ["language", "theme", "cart", "account"] };
  const input = { locale: "en", t, categories, searchEnabled: true } as const;

  it("lists the theme control and puts the switch into the menu's panel for a phone", () => {
    const view = headerView(withTheme, { ...input, showThemeSwitch: true });
    expect(view[0]).toMatchObject({ kind: "menu", withTheme: true });
    expect(view.at(-1)).toEqual({
      kind: "controls",
      controls: ["language", "theme", "cart", "account"],
      themeInMenu: true,
    });
  });

  it("keeps the control on a phone when there is no menu to carry the switch", () => {
    const view = headerView(
      { ...withTheme, blocks: ["logo", "search", "controls"] },
      { ...input, showThemeSwitch: true },
    );
    expect(view.at(-1)).toMatchObject({ kind: "controls", themeInMenu: false });
    const noLinks = headerView(
      { ...withTheme, navigation: { categoryLimit: 0, links: [] } },
      { ...input, showThemeSwitch: true },
    );
    expect(noLinks.at(-1)).toMatchObject({ kind: "controls", themeInMenu: false });
  });

  it("drops the control (and an emptied controls block) while config/theme.ts hides the switch", () => {
    const view = headerView(withTheme, { ...input, showThemeSwitch: false });
    expect(view[0]).toMatchObject({ kind: "menu", withTheme: false });
    expect(view.at(-1)).toEqual({
      kind: "controls",
      controls: ["language", "cart", "account"],
      themeInMenu: false,
    });
    const onlyTheme = headerView(
      { ...withTheme, controls: ["theme"] },
      { ...input, showThemeSwitch: false },
    );
    expect(onlyTheme.map((block) => block.kind)).toEqual(["menu", "logo", "navigation", "search"]);
  });

  it("tells the footer whether the header carries the switch", () => {
    expect(headerHasThemeControl(withTheme)).toBe(true);
    expect(headerHasThemeControl(base)).toBe(false);
    expect(headerHasThemeControl({ ...withTheme, blocks: ["logo", "search"] })).toBe(false);
  });

  it("refuses the theme control listed twice", () => {
    expect(
      headerConfigProblems({ ...withTheme, controls: ["theme", "theme"] }, keysOf("en")),
    ).toEqual(['header control "theme" is listed more than once']);
  });
});

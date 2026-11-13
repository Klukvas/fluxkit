import { describe, expect, it } from "vitest";
import { footerConfig } from "../config/footer";
import { headerConfig } from "../config/header";
import { themeConfig } from "../config/theme";
import { messagesByLocale } from "../messages";
import { contactsView } from "../lib/contacts";
import {
  FOOTER_GROUP_HEADINGS,
  assertFooterConfig,
  footerConfigProblems,
  footerView,
  type FooterConfig,
} from "./footer-layout";
import { headerHasThemeControl } from "./header-layout";

/** The switch shown and only in the footer (the checks below are about the footer's own block). */
const footerOnly = { showToggle: true, inHeader: false };

const keysOf = (locale: "uk" | "en") => new Set(Object.keys(messagesByLocale[locale]));
const contacts = contactsView();
const shopLinks = [{ labelKey: "shopPages.about.title", href: "/about" }];
const legalLinks = [{ labelKey: "legal.privacy.title", href: "/legal/privacy" }];
const base: FooterConfig = {
  blocks: ["navigation", "contacts", "themeSwitch", "copyright"],
  navigation: { groups: [{ kind: "shopPages" }, { kind: "legal" }] },
};
const input = { shopLinks, legalLinks, contacts, showThemeSwitch: true, themeInHeader: false };
const group = (links: typeof shopLinks, headingKey: string | null = null) => ({
  headingKey,
  links,
});

describe("the footer config in config/footer.ts", () => {
  // Runs on the template's file and, in the fork run (`vitest.brand-fork.config.ts`), on a filled fork config. The theme
  // switch check reads the real header config: the template's switch is the header's `theme` control.
  it("has no problems in either language", () => {
    const theme = {
      showToggle: themeConfig.showToggle,
      inHeader: headerHasThemeControl(headerConfig),
    };
    for (const locale of ["uk", "en"] as const) {
      expect(footerConfigProblems(footerConfig, keysOf(locale), theme)).toEqual([]);
    }
  });
});

describe("footerView", () => {
  it("keeps the configured block order and resolves the link groups in their order", () => {
    expect(footerView(base, input)).toEqual([
      { kind: "navigation", groups: [group(shopLinks), group(legalLinks)] },
      { kind: "contacts", contacts },
      { kind: "themeSwitch" },
      { kind: "copyright" },
    ]);
  });

  it("follows another order with the fork's own link group, and leaves out blocks that are not listed", () => {
    const own = [{ labelKey: "nav.catalog", href: "/catalog" }];
    const view = footerView(
      {
        blocks: ["copyright", "navigation"],
        navigation: { groups: [{ kind: "legal" }, { kind: "links", links: own }] },
      },
      { ...input, showThemeSwitch: false },
    );
    expect(view).toEqual([
      { kind: "copyright" },
      { kind: "navigation", groups: [group(legalLinks), group(own)] },
    ]);
  });

  it("drops empty link groups, a navigation with no links at all (no empty landmark), and the switch when the theme config hides it", () => {
    const view = footerView(base, { ...input, shopLinks: [], showThemeSwitch: false });
    expect(view.map((block) => block.kind)).toEqual(["navigation", "contacts", "copyright"]);
    expect(view[0]).toEqual({ kind: "navigation", groups: [group(legalLinks)] });
    const noLinks = footerView(base, { ...input, shopLinks: [], legalLinks: [] });
    expect(noLinks.map((block) => block.kind)).not.toContain("navigation");
  });
});

describe("footerConfigProblems", () => {
  const problems = (config: FooterConfig, theme = footerOnly) =>
    footerConfigProblems(config, keysOf("en"), theme);

  it("accepts the reference config", () => {
    expect(problems(base)).toEqual([]);
  });

  it("refuses a block or a built-in link group listed twice", () => {
    expect(problems({ ...base, blocks: [...base.blocks, "copyright"] })).toEqual([
      'footer block "copyright" is listed more than once',
    ]);
    expect(
      problems({ ...base, navigation: { groups: [{ kind: "legal" }, { kind: "legal" }] } }),
    ).toEqual(['footer link group "legal" is listed more than once']);
  });

  it("refuses an empty own link group, an unknown message key and a path that is not a plain storefront path", () => {
    const withGroup = (links: { labelKey: string; href: string }[]) =>
      problems({ ...base, navigation: { groups: [{ kind: "legal" }, { kind: "links", links }] } });
    expect(withGroup([])).toEqual(["footer link group 2 has no links"]);
    expect(withGroup([{ labelKey: "nav.nope", href: "/catalog" }])).toEqual([
      'footer link "/catalog": message key "nav.nope" does not exist',
    ]);
    expect(withGroup([{ labelKey: "nav.catalog", href: "//example.com" }])).toEqual([
      'footer link "//example.com" is not a plain storefront path',
    ]);
  });

  it("refuses a footer without the theme switch while config/theme.ts shows it and the header has no theme control (the choice could never be changed back)", () => {
    const blocks = base.blocks.filter((block) => block !== "themeSwitch");
    expect(() => footerView({ ...base, blocks }, input)).toThrow(
      /config\/footer\.ts is invalid: footer block "themeSwitch" is missing/,
    );
    expect(() => assertFooterConfig(base, footerOnly)).not.toThrow();
    expect(problems({ ...base, blocks })).toEqual([
      'footer block "themeSwitch" is missing while `showToggle` in config/theme.ts is true and config/header.ts lists no "theme" control: list one of them, or set `showToggle: false` to hide the switch',
    ]);
    expect(problems({ ...base, blocks }, { showToggle: false, inHeader: false })).toEqual([]);
  });

  it("accepts a footer without the switch when the header lists the theme control, and both places at once", () => {
    const blocks = base.blocks.filter((block) => block !== "themeSwitch");
    const inHeader = { showToggle: true, inHeader: true };
    expect(problems({ ...base, blocks }, inHeader)).toEqual([]);
    expect(problems(base, inHeader)).toEqual([]);
    expect(() => footerView({ ...base, blocks }, { ...input, themeInHeader: true })).not.toThrow();
  });
});

describe("the columns layout (round 4)", () => {
  const columns: FooterConfig = {
    layout: "columns",
    blocks: ["navigation", "contacts", "copyright"],
    navigation: { groups: [{ kind: "shopPages" }, { kind: "legal" }] },
  };
  const problems = (config: FooterConfig) =>
    footerConfigProblems(config, keysOf("en"), { showToggle: true, inHeader: true });

  it("gives the built-in groups their default headings, keeps a configured one, and leaves the stack layout without", () => {
    const view = footerView(
      {
        ...columns,
        navigation: {
          groups: [{ kind: "shopPages" }, { kind: "legal", headingKey: "footer.nav.label" }],
        },
      },
      { ...input, themeInHeader: true },
    );
    expect(view[0]).toEqual({
      kind: "navigation",
      groups: [
        group(shopLinks, FOOTER_GROUP_HEADINGS.shopPages),
        group(legalLinks, "footer.nav.label"),
      ],
    });
    expect(footerView(base, input)[0]).toEqual({
      kind: "navigation",
      groups: [group(shopLinks), group(legalLinks)],
    });
  });

  it("has its default headings in both locales", () => {
    for (const locale of ["uk", "en"] as const) {
      for (const key of [...Object.values(FOOTER_GROUP_HEADINGS), "footer.group.contacts"]) {
        expect(keysOf(locale).has(key), `${locale} ${key}`).toBe(true);
      }
    }
  });

  it("refuses an own link group without a heading (each column is a navigation named by it)", () => {
    const own = { labelKey: "nav.catalog", href: "/catalog" };
    expect(
      problems({ ...columns, navigation: { groups: [{ kind: "links", links: [own] }] } }),
    ).toEqual([
      "footer link group 1 needs a headingKey in the columns layout (each column is a navigation named by its heading)",
    ]);
    expect(
      problems({
        ...columns,
        navigation: { groups: [{ kind: "links", links: [own], headingKey: "footer.nav.label" }] },
      }),
    ).toEqual([]);
    // The stack layout keeps the heading optional.
    expect(
      problems({ ...base, navigation: { groups: [{ kind: "links", links: [own] }] } }),
    ).toEqual([]);
  });
});

describe("footer text lines and group headings", () => {
  const problems = (config: FooterConfig) => footerConfigProblems(config, keysOf("en"), footerOnly);

  it("renders text blocks in their place and passes a group's heading key on", () => {
    const view = footerView(
      {
        blocks: [
          { kind: "text", textKey: "footer.nav.label" },
          "navigation",
          "themeSwitch",
          "copyright",
        ],
        navigation: {
          groups: [{ kind: "legal", headingKey: "footer.nav.label" }, { kind: "shopPages" }],
        },
      },
      input,
    );
    expect(view).toEqual([
      { kind: "text", textKey: "footer.nav.label" },
      { kind: "navigation", groups: [group(legalLinks, "footer.nav.label"), group(shopLinks)] },
      { kind: "themeSwitch" },
      { kind: "copyright" },
    ]);
  });

  it("refuses an empty block list, a repeated or unknown text key, an unknown heading key and a repeated link in a group", () => {
    expect(problems({ ...base, blocks: [] })).toEqual([
      "footer lists no blocks",
      'footer block "themeSwitch" is missing while `showToggle` in config/theme.ts is true and config/header.ts lists no "theme" control: list one of them, or set `showToggle: false` to hide the switch',
    ]);
    const text = { kind: "text", textKey: "footer.nav.label" } as const;
    expect(problems({ ...base, blocks: [...base.blocks, text, text] })).toEqual([
      'footer text "footer.nav.label" is listed more than once',
    ]);
    expect(
      problems({ ...base, blocks: [...base.blocks, { kind: "text", textKey: "custom.nope" }] }),
    ).toEqual(['footer text: message key "custom.nope" does not exist']);
    expect(
      problems({ ...base, navigation: { groups: [{ kind: "legal", headingKey: "custom.nope" }] } }),
    ).toEqual(['footer link group 1: heading key "custom.nope" does not exist']);
    const link = { labelKey: "nav.catalog", href: "/catalog" };
    expect(
      problems({ ...base, navigation: { groups: [{ kind: "links", links: [link, link] }] } }),
    ).toEqual(['footer link "/catalog" is listed more than once in group 1']);
  });
});

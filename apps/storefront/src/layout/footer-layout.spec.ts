import { describe, expect, it } from "vitest";
import { footerConfig } from "../config/footer";
import { themeConfig } from "../config/theme";
import { messagesByLocale } from "../messages";
import { contactsView } from "../lib/contacts";
import { footerConfigProblems, footerView, type FooterConfig } from "./footer-layout";

const keysOf = (locale: "uk" | "en") => new Set(Object.keys(messagesByLocale[locale]));
const contacts = contactsView();
const shopLinks = [{ labelKey: "shopPages.about.title", href: "/about" }];
const legalLinks = [{ labelKey: "legal.privacy.title", href: "/legal/privacy" }];
const base: FooterConfig = {
  blocks: ["navigation", "contacts", "themeSwitch", "copyright"],
  navigation: { groups: [{ kind: "shopPages" }, { kind: "legal" }] },
};
const input = { shopLinks, legalLinks, contacts, showThemeSwitch: true };

describe("the footer config in config/footer.ts", () => {
  // Runs on the template's file and, in the fork run (`vitest.brand-fork.config.ts`), on a filled fork config.
  it("has no problems in either language", () => {
    for (const locale of ["uk", "en"] as const) {
      expect(footerConfigProblems(footerConfig, keysOf(locale), themeConfig.showToggle)).toEqual(
        [],
      );
    }
  });
});

describe("footerView", () => {
  it("keeps the configured block order and resolves the link groups in their order", () => {
    expect(footerView(base, input)).toEqual([
      { kind: "navigation", groups: [shopLinks, legalLinks] },
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
      input,
    );
    expect(view).toEqual([
      { kind: "copyright" },
      { kind: "navigation", groups: [legalLinks, own] },
    ]);
  });

  it("drops empty link groups, a navigation with no links at all (no empty landmark), and the switch when the theme config hides it", () => {
    const view = footerView(base, { ...input, shopLinks: [], showThemeSwitch: false });
    expect(view.map((block) => block.kind)).toEqual(["navigation", "contacts", "copyright"]);
    expect(view[0]).toEqual({ kind: "navigation", groups: [legalLinks] });
    const noLinks = footerView(base, { ...input, shopLinks: [], legalLinks: [] });
    expect(noLinks.map((block) => block.kind)).not.toContain("navigation");
  });
});

describe("footerConfigProblems", () => {
  const problems = (config: FooterConfig, showToggle = true) =>
    footerConfigProblems(config, keysOf("en"), showToggle);

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

  it("refuses a footer without the theme switch while config/theme.ts shows it (the choice could never be changed back)", () => {
    const blocks = base.blocks.filter((block) => block !== "themeSwitch");
    expect(problems({ ...base, blocks })).toEqual([
      'footer block "themeSwitch" is missing while `showToggle` in config/theme.ts is true: set `showToggle: false` to hide the switch',
    ]);
    expect(problems({ ...base, blocks }, false)).toEqual([]);
  });
});

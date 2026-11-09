import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { locales } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { DEMO_CONTENT_FLAGS } from "../../next.config.js";
import { footerShopLinks } from "../layout/navigation";
import { messagesByLocale } from "../messages";
import {
  RESERVED_SLUGS,
  checkShopPages,
  findShopPage,
  optionGuideLink,
  paragraphsOf,
  productNoteView,
  shopPageLinks,
  shopPageMessageKeys,
  shopPagePath,
  shopPagePaths,
} from "../lib/shop-pages";
import { demoContent } from "./demo-content";
import { trustBarItems } from "./trust-bar";
import {
  productOptionGuide,
  productPageNote,
  shopPages,
  type ShopPageConfig,
  type ShopPageSection,
} from "./shop-pages";

const { uk, en } = messagesByLocale;

const localeRoot = join(import.meta.dirname, "..", "app", "[locale]");

function page(slug: string, sections: readonly ShopPageSection[] = []): ShopPageConfig {
  return {
    slug: slug as ShopPageConfig["slug"],
    titleKey: "shopPages.faq.title",
    descriptionKey: "shopPages.faq.description",
    inFooter: true,
    sections,
  };
}

describe("shop pages config (config/shop-pages.ts)", () => {
  it("passes its own check and lists the six pages of the template", () => {
    expect(() => checkShopPages(shopPages)).not.toThrow();
    expect(shopPages.map((entry) => entry.slug)).toEqual([
      "delivery-and-payment",
      "returns",
      "faq",
      "about",
      "size-guide",
      "contacts",
    ]);
  });

  it("has every message key of every page in both languages, non-empty", () => {
    for (const entry of shopPages) {
      for (const key of shopPageMessageKeys(entry)) {
        expect((uk as Record<string, string>)[key], `uk ${key}`).toBeTruthy();
        expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      }
    }
    if (productPageNote !== null) {
      for (const key of [productPageNote.titleKey, productPageNote.summaryKey]) {
        expect((uk as Record<string, string>)[key], key).toBeTruthy();
        expect((en as Record<string, string>)[key], key).toBeTruthy();
      }
    }
  });

  it("uses no slug another route owns: every first segment under [locale] is reserved", () => {
    const owned = readdirSync(localeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        entry.name.startsWith("(")
          ? readdirSync(join(localeRoot, entry.name), { withFileTypes: true })
              .filter((child) => child.isDirectory() && !child.name.startsWith("["))
              .map((child) => child.name)
          : entry.name.startsWith("[")
            ? []
            : [entry.name],
      );
    expect(owned.length).toBeGreaterThan(5);
    for (const segment of owned) expect(RESERVED_SLUGS, segment).toContain(segment);
    for (const entry of shopPages) expect(RESERVED_SLUGS).not.toContain(entry.slug);
  });

  it("is rendered by one route without a loading view (an unknown slug is a real 404)", () => {
    expect(existsSync(join(localeRoot, "(pages)", "[page]", "page.tsx"))).toBe(true);
    expect(existsSync(join(localeRoot, "(pages)", "loading.tsx"))).toBe(false);
  });

  it("refuses a repeated or reserved slug, a malformed id, a table row of the wrong length, an empty table or FAQ", () => {
    expect(() => checkShopPages([page("faq"), page("faq")])).toThrow(/twice/);
    expect(() => checkShopPages([page("cart")])).toThrow(/another route/);
    expect(() => checkShopPages([page("Bad Slug")])).toThrow(/lowercase/);
    const text: ShopPageSection = { kind: "text", id: "a", bodyKey: "shopPages.faq.title" };
    expect(() => checkShopPages([page("faq", [text, text])])).toThrow(/repeated/);
    const table = (rows: readonly (readonly { value: string }[])[]): ShopPageSection => ({
      kind: "table",
      id: "t",
      titleKey: "x",
      captionKey: "x",
      columnKeys: ["a", "b"],
      rows,
    });
    expect(() => checkShopPages([page("faq", [table([[{ value: "1" }]])])])).toThrow(
      /1 cells for 2/,
    );
    expect(() => checkShopPages([page("faq", [table([])])])).toThrow(/columns and rows/);
    expect(() =>
      checkShopPages([page("faq", [table([[{ value: "1" }, { value: " " }]])])]),
    ).toThrow(/empty cell/);
    expect(() => checkShopPages([page("faq", [{ kind: "faq", id: "f", items: [] }])])).toThrow(
      /no question/,
    );
    const item = { id: "q", questionKey: "a", answerKey: "b" };
    expect(() =>
      checkShopPages([page("faq", [{ kind: "faq", id: "f", items: [item, item] }])]),
    ).toThrow(/repeated/);
  });

  it("refuses a 'See also' link to an unknown slug, and allows a known page that is not enabled (the link is dropped)", () => {
    const links = (pages: readonly string[]): ShopPageSection => ({
      kind: "links",
      id: "l",
      titleKey: "shopPages.seeAlso",
      pages: pages as readonly ShopPageConfig["slug"][],
    });
    expect(() => checkShopPages([page("faq", [links(["shipping"])])])).toThrow(
      /"shipping" of "faq" names no known shop page/,
    );
    // `returns` is known but not in this list: allowed, and `shopPageLinks` leaves it out.
    const pages = [page("faq", [links(["returns", "faq"])])];
    expect(() => checkShopPages(pages)).not.toThrow();
    expect(shopPageLinks("en", ["returns", "faq"], pages).map((link) => link.slug)).toEqual([
      "faq",
    ]);
  });

  it("reserves the locale codes, so no page is named like a language", () => {
    for (const locale of locales) {
      expect(RESERVED_SLUGS).toContain(locale);
      expect(() => checkShopPages([page(locale)])).toThrow(/another route/);
    }
  });

  it("finds an enabled page, and nothing for an unknown or removed slug", () => {
    expect(findShopPage("faq")?.slug).toBe("faq");
    expect(findShopPage("no-such-page")).toBeNull();
    expect(findShopPage("faq", [page("returns")])).toBeNull();
    expect(findShopPage("FAQ")).toBeNull();
  });

  it("links only enabled pages: a removed page leaves the footer, the trust bar, the note and the sitemap", () => {
    expect(footerShopLinks.map((link) => link.href)).toEqual(
      shopPages.filter((entry) => entry.inFooter).map((entry) => `/${entry.slug}`),
    );
    expect(shopPagePath("contacts")).toBe("/contacts");
    expect(shopPagePath("contacts", [page("faq")])).toBeNull();
    expect(shopPageLinks("uk", ["faq", "contacts"], [page("faq")])).toEqual([
      { slug: "faq", href: "/uk/faq", titleKey: "shopPages.faq.title" },
    ]);
    expect(shopPagePaths([page("faq")])).toEqual(["/faq"]);
    expect(productNoteView("en")?.links.map((link) => link.href)).toEqual([
      "/en/delivery-and-payment",
      "/en/returns",
    ]);
    expect(productNoteView("en", productPageNote, [page("faq")])).toBeNull();
    expect(productNoteView("en", null)).toBeNull();
  });

  // UX round 2, batch 3A item 7: a link to the size guide next to the option pickers, data-driven (no option code is read).
  it("links the option guide (the size guide by default) only while that page is enabled", () => {
    expect(productOptionGuide).toBe("size-guide");
    expect(optionGuideLink("uk")).toEqual({
      slug: "size-guide",
      href: "/uk/size-guide",
      titleKey: "shopPages.sizeGuide.title",
    });
    expect(optionGuideLink("en", "size-guide", [page("faq")])).toBeNull();
    expect(optionGuideLink("en", null)).toBeNull();
  });

  it("links the trust bar's contact line to the contacts page", () => {
    expect(trustBarItems.find((item) => item.icon === "contact")?.page).toBe("contacts");
  });

  it("splits a text into paragraphs on blank lines", () => {
    expect(paragraphsOf("one\n\n two \n \nthree\nstill three\n\n\n")).toEqual([
      "one",
      "two",
      "three\nstill three",
    ]);
    expect(paragraphsOf("   ")).toEqual([]);
  });
});

describe("demo content (config/demo-content.json, the release check's list)", () => {
  it("names only configured pages, and master marks every page and every flag as demo copy", () => {
    const slugs = shopPages.map((entry) => entry.slug);
    for (const slug of demoContent.shopPages) expect(slugs).toContain(slug);
    expect([...demoContent.shopPages].sort()).toEqual([...slugs].sort());
    expect(demoContent.contacts && demoContent.home && demoContent.trustBar).toBe(true);
  });

  it("has exactly the keys the release check in next.config.ts reads", () => {
    expect(Object.keys(demoContent).sort()).toEqual(["shopPages", ...DEMO_CONTENT_FLAGS].sort());
  });
});

import { describe, expect, it } from "vitest";
import {
  COMPUTED_STYLE_MOBILE_PAGES,
  COMPUTED_STYLE_PAGES,
  REQUIRED_SELECTORS,
  missingRequiredSelectors,
} from "./pages.ts";
import { SELECTOR_NAMES } from "./selectors.ts";
import { COMPUTED_PROPERTIES } from "./snapshot.ts";

const found = () => Object.fromEntries(COMPUTED_PROPERTIES.map((property) => [property, "0px"]));

describe("required selectors (positive coverage)", () => {
  it("names a known selector list for every computed-style page", () => {
    for (const page of [...COMPUTED_STYLE_PAGES, ...COMPUTED_STYLE_MOBILE_PAGES]) {
      const required = REQUIRED_SELECTORS[page.id];
      expect(required, page.id).toBeDefined();
      for (const name of required ?? [])
        expect(SELECTOR_NAMES.has(name), `${page.id}: ${name}`).toBe(true);
    }
    for (const page of COMPUTED_STYLE_PAGES) {
      expect(REQUIRED_SELECTORS[page.id]).toEqual(
        expect.arrayContaining(["page.body", "header.banner", "main.h1", "footer.contentinfo"]),
      );
    }
    expect(REQUIRED_SELECTORS["cart"]).toContain("button.secondary");
    expect(REQUIRED_SELECTORS["catalog"]).toEqual(
      expect.arrayContaining(["card.article", "card.title", "price.text"]),
    );
  });

  it("reports a required selector that was absent or not recorded, and nothing when all are found", () => {
    const required = REQUIRED_SELECTORS["cart"] ?? [];
    const all = Object.fromEntries(required.map((name) => [name, found()]));
    expect(missingRequiredSelectors("cart", all)).toEqual([]);
    expect(missingRequiredSelectors("cart", { ...all, "button.secondary": null })).toEqual([
      "button.secondary",
    ]);
    const withoutH1 = { ...all };
    delete withoutH1["main.h1"];
    expect(missingRequiredSelectors("cart", withoutH1)).toEqual(["main.h1"]);
  });

  it("refuses a page id without a required list", () => {
    expect(() => missingRequiredSelectors("nowhere", {})).toThrow(/no required selectors/);
  });
});

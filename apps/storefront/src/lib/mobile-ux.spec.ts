import { describe, expect, it } from "vitest";
import {
  buyBarShown,
  nextTrapIndex,
  openFacetKeys,
  selectedFilterCount,
  selectionSummary,
} from "./mobile-ux";
import type { SearchQuery } from "./search-query";

const query = (facets: string[], price: SearchQuery["price"] = null): SearchQuery => ({
  q: "",
  facets,
  price,
  sort: null,
  page: 1,
});

describe("the product page's sticky buy bar (plan 2026-11-03-storefront-mobile-ux.md, item 2)", () => {
  it("shows only while the inline button is out of view and the footer is not in view", () => {
    expect(buyBarShown({ ctaInView: false, footerInView: false })).toBe(true);
    expect(buyBarShown({ ctaInView: true, footerInView: false })).toBe(false);
    expect(buyBarShown({ ctaInView: false, footerInView: true })).toBe(false);
    // Before the first observation nothing is known: the bar stays hidden (no flash on load).
    expect(buyBarShown({ ctaInView: null, footerInView: false })).toBe(false);
  });

  it("names the chosen option values in the options' order, skipping an option without a choice", () => {
    const product = {
      options: [
        {
          code: "color",
          values: [
            { code: "black", name: "Black" },
            { code: "blue", name: "Blue" },
          ],
        },
        {
          code: "size",
          values: [
            { code: "s", name: "S" },
            { code: "m", name: "M" },
          ],
        },
      ],
    };
    expect(selectionSummary(product, { size: "m", color: "blue" }, " · ")).toBe("Blue · M");
    expect(selectionSummary(product, { size: "s" }, " · ")).toBe("S");
    expect(selectionSummary(product, {}, " · ")).toBe("");
    // A code the product does not have (an old address) is not shown.
    expect(selectionSummary(product, { color: "green" }, " · ")).toBe("");
  });
});

describe("the mobile filter sheet (item 3)", () => {
  it("counts every chosen value and a price range, but not the facets the page decides itself", () => {
    expect(selectedFilterCount(query([]), [])).toBe(0);
    expect(selectedFilterCount(query(["opt.size:m", "opt.size:l", "brand:demo"]), [])).toBe(3);
    expect(selectedFilterCount(query(["attr.length:1..5"], { min: 100, max: null }), [])).toBe(2);
    expect(selectedFilterCount(query(["category:x", "brand:demo"]), ["category"])).toBe(1);
  });

  it("opens the first two groups and every group with a choice", () => {
    const facets = [
      { key: "brand", values: [{ selected: false }] },
      { key: "inStock", values: [{ selected: false }] },
      { key: "opt.color", values: [{ selected: false }] },
      { key: "opt.size", values: [{ selected: true }] },
      { key: "attr.length", values: [] },
    ];
    expect(openFacetKeys(facets, query(["opt.size:m"]), 2)).toEqual(
      new Set(["brand", "inStock", "opt.size"]),
    );
    // A chosen range has no selected value: the address says it.
    expect(openFacetKeys(facets, query(["attr.length:1..5"]), 0)).toEqual(
      new Set(["opt.size", "attr.length"]),
    );
  });

  it("keeps Tab inside the sheet: from the last control to the first and back", () => {
    // Inside the list the browser moves the focus itself (null).
    expect(nextTrapIndex(3, 1, false)).toBe(null);
    expect(nextTrapIndex(3, 1, true)).toBe(null);
    expect(nextTrapIndex(3, 2, false)).toBe(0);
    expect(nextTrapIndex(3, 0, true)).toBe(2);
    // Focus outside the sheet: the first control (Tab) or the last (Shift+Tab).
    expect(nextTrapIndex(3, -1, false)).toBe(0);
    expect(nextTrapIndex(3, -1, true)).toBe(2);
    expect(nextTrapIndex(0, -1, false)).toBe(null);
  });
});

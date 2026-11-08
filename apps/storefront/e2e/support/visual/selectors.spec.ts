import { describe, expect, it } from "vitest";
import {
  ELEMENT_SHOT_PAGE_ID,
  ELEMENT_SHOT_SELECTORS,
  COMPUTED_STYLE_PAGES,
  frameName,
  knownPageIds,
  screenshotFrames,
} from "./pages.ts";
import { SELECTORS, SELECTOR_LIST_VERSION, selectorByName } from "./selectors.ts";

describe("the visual selector list", () => {
  it("is versioned and names every entry once, as <area>.<element>", () => {
    expect(SELECTOR_LIST_VERSION).toBeGreaterThanOrEqual(1);
    const names = SELECTORS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
  });

  it("never locates by a class (role, data attribute, element, id or text only)", () => {
    for (const entry of SELECTORS) {
      expect(entry.steps.length, entry.name).toBeGreaterThan(0);
      for (const step of entry.steps) {
        if ("css" in step) {
          // A class selector is a dot outside quotes; attribute values in quotes may contain anything.
          expect(step.css.replace(/"[^"]*"|'[^']*'/g, ""), entry.name).not.toContain(".");
          expect(step.css, entry.name).not.toMatch(/\[class/);
        }
      }
    }
  });

  it("keeps the steps well formed (one kind per step, level only on headings, valid patterns)", () => {
    for (const entry of SELECTORS) {
      expect(entry.description.length, entry.name).toBeGreaterThan(10);
      for (const step of entry.steps) {
        const kinds = ["role", "css", "text"].filter((kind) => kind in step);
        expect(kinds, entry.name).toHaveLength(1);
        if ("role" in step) {
          if (step.level !== undefined) expect(step.role, entry.name).toBe("heading");
          if (step.name !== undefined) expect(() => new RegExp(step.name as string)).not.toThrow();
        }
        if ("text" in step) expect(() => new RegExp(step.text)).not.toThrow();
      }
    }
  });

  it("covers what the plan lists (header, nav, search, buttons, inputs, card, price, badges, banner, footer, headings, dialog, alert)", () => {
    for (const name of [
      "header.banner",
      "header.nav-link",
      "header.search-input",
      "button.primary",
      "button.secondary",
      "form.textbox",
      "form.select",
      "form.checkbox",
      "card.article",
      "card.title",
      "price.text",
      "card.badge",
      "product.badge",
      "home.banner-card",
      "footer.contentinfo",
      "main.h1",
      "main.h2",
      "main.h3",
      "overlay.dialog",
      "feedback.alert",
      "feedback.status",
      "main.link",
    ]) {
      expect(() => selectorByName(name)).not.toThrow();
    }
    expect(() => selectorByName("nope.nothing")).toThrow(/Unknown visual selector/);
  });

  it("finds a uk price with the selector's text pattern", () => {
    const step = selectorByName("price.text").steps[0];
    if (step === undefined || !("text" in step)) throw new Error("price.text must be a text step");
    const pattern = new RegExp(step.text);
    const uk = new Intl.NumberFormat("uk", { style: "currency", currency: "UAH" });
    expect(uk.format(1199)).toMatch(pattern);
    expect(uk.format(12.5)).toMatch(pattern);
    expect("Без ціни").not.toMatch(pattern);
  });
});

describe("the visual pages and frames", () => {
  it("compares 8 pages and gives every frame a unique file name", () => {
    expect(COMPUTED_STYLE_PAGES).toHaveLength(8);
    const names = screenshotFrames().map(frameName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("home-390-light");
    expect(names).toContain("product-1280-system");
    expect(names).toContain("en-catalog-1280-dark");
    expect(names).not.toContain("en-catalog-390-dark");
    expect(names).toContain("register-390-light-nojs");
    expect(names).toContain("en-register-1280-light-nojs");
    expect(names).toContain("not-found-1280-dark");
  });

  it("names only known selectors and pages for the element shots", () => {
    expect(knownPageIds().has(ELEMENT_SHOT_PAGE_ID)).toBe(true);
    for (const name of ELEMENT_SHOT_SELECTORS) expect(() => selectorByName(name)).not.toThrow();
  });
});

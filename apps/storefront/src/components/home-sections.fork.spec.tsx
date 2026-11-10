import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { checkHomeSections } from "../config/home";
import { customSections } from "../config/custom-sections";
import { resolveCustomSection } from "../lib/custom-sections";
import type { HomeSectionResult } from "../lib/home-data";
import { forkHomeSections } from "../lib/home-fork-fixture";
import { category } from "../lib/test-fixtures";
import { HomeSectionsView } from "./home-sections";
import { leftoverText, sentinelTranslator } from "./test-helpers";

// Runs ONLY in `vitest.home-fork.config.ts`, where `config/custom-sections.ts` is the filled fixture
// (`lib/home-fork-fixture.tsx`): a fork's home config with `width: "full"` and a custom section renders as documented.

const results: Record<string, HomeSectionResult> = {
  "home-categories": {
    status: "ok",
    data: { kind: "categories", categories: [category("books", [], { name: "§books" })] },
  },
};

const html = renderToStaticMarkup(
  <HomeSectionsView
    sections={forkHomeSections}
    context={{ locale: "en", t: sentinelTranslator(), imageHosts: [] }}
    results={results}
  />,
);

const band =
  '<div class="mx-auto w-full max-w-6xl px-4 relative isolate py-8 empty:hidden before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-screen before:-translate-x-1/2 before:bg-muted" data-home-width="full">';
const contained =
  '<div class="mx-auto w-full max-w-6xl px-4 empty:hidden" data-home-width="contained">';

describe("a fork's home config with width and a custom section", () => {
  it("runs with the fork's registry, and every custom name of its config resolves", () => {
    expect(Object.keys(customSections)).toEqual(["brandStrip"]);
    expect(() => {
      checkHomeSections(forkHomeSections);
    }).not.toThrow();
    for (const section of forkHomeSections) {
      if (section.kind === "custom") {
        expect(resolveCustomSection(section, customSections), section.id).not.toBeNull();
      }
    }
  });

  it("puts the hero and the brand strip in full-bleed bands and the other sections in their own containers", () => {
    expect(html.startsWith('<div class="flex flex-col gap-12 py-8 overflow-x-clip">')).toBe(true);
    expect(html).toContain(`${band}<section aria-labelledby="home-hero-title" data-hero=""`);
    expect(html).toContain(
      `${band}<section aria-labelledby="home-brands-title" data-fork-brand-strip="">`,
    );
    expect(html).toContain(`${contained}<section aria-labelledby="home-categories-title"`);
    expect(html.match(/data-home-width="full"/g)).toHaveLength(2);
    expect(html.match(/data-home-width="contained"/g)).toHaveLength(3);
  });

  it("keeps the page outline: the hero's h1 first, then one h2 per section, in the configured order", () => {
    expect([...html.matchAll(/<h([1-6])[ >]/g)].map((match) => `h${match[1]}`)).toEqual([
      "h1",
      "h2",
      "h2",
      "h2",
      "h2",
    ]);
    expect(html.indexOf("§custom.brandStrip.title")).toBeLessThan(
      html.indexOf("§home.categoryTiles.title"),
    );
    expect(leftoverText(html)).toBe("");
  });
});

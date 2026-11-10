import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customSections } from "../config/custom-sections";
import { homeSections } from "../config/home";
import type { HomeSectionResult } from "../lib/home-data";
import { category } from "../lib/test-fixtures";
import { messagesByLocale } from "../messages";
import { HomeSectionsView } from "./home-sections";

// Runs ONLY in `vitest.home-fork.config.ts`, where `config/home.ts`, `config/custom-sections.ts` and the message extras are
// a fork's (`lib/home-fork-fixture.tsx`, `lib/messages-extra-fork-fixture.{uk,en}.json`): the reshaped home page renders as
// documented, with the fork's own texts.

const results: Record<string, HomeSectionResult> = {
  "home-categories": {
    status: "ok",
    data: { kind: "categories", categories: [category("books", [], { name: "Books" })] },
  },
};

const html = renderToStaticMarkup(
  <HomeSectionsView
    sections={homeSections}
    context={{ locale: "en", t: createTranslator(messagesByLocale.en, "en"), imageHosts: [] }}
    results={results}
  />,
);

const contained =
  '<div class="mx-auto w-full max-w-6xl px-4 empty:hidden" data-home-width="contained">';

describe("a fork's reshaped home page (full-width custom section first, a contained custom section)", () => {
  it("runs with the fork's config, registry and extras", () => {
    expect(Object.keys(customSections)).toEqual(["brandStrip", "promo"]);
    expect(homeSections[0]).toMatchObject({ kind: "custom", width: "full" });
    expect(messagesByLocale.uk["custom.brandStrip.title"]).toBe("Наші бренди");
  });

  it("renders the full section edge to edge, flush under the header, with the surface it chose", () => {
    expect(
      html.startsWith(
        '<div class="flex flex-col gap-12 py-8"><h1 class="sr-only">' +
          messagesByLocale.en["site.name"] +
          '</h1><div class="empty:hidden [[data-home-width=full]:not(:empty)+&amp;]:-mt-12 -mt-8" data-home-width="full"><section aria-labelledby="home-brands-title" data-fork-brand-strip="" class="bg-muted py-8"><div class="mx-auto w-full max-w-6xl px-4">',
      ),
    ).toBe(true);
    expect(html).not.toContain('<div class="mx-auto w-full max-w-6xl px-4"><div class="flex');
  });

  it("puts every other section in its own container, the contained custom section included", () => {
    expect(html.match(/data-home-width="contained"/g)).toHaveLength(5);
    expect(html).toContain(
      `${contained}<section aria-labelledby="home-promo-title" data-fork-promo="">`,
    );
    expect(html).toContain(`${contained}<section aria-labelledby="home-categories-title"`);
    expect(html).toContain("Deal of the week");
  });

  it("keeps one h1 (visually hidden: the first section is not a hero) and one h2 per section, in order", () => {
    expect([...html.matchAll(/<h([1-6])[ >]/g)].map((match) => `h${match[1]}`)).toEqual([
      "h1",
      "h2",
      "h2",
      "h2",
      "h2",
      "h2",
      "h2",
    ]);
    expect(html.indexOf("Our brands")).toBeLessThan(html.indexOf("Deal of the week"));
  });
});

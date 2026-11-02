import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  homeSections,
  type CategoriesSection,
  type HeroSection,
  type HomeSection,
  type ProductRowSection,
  type RichTextSection,
  type TrustSection,
} from "../config/home";
import type { HomeSectionResult } from "../lib/home-data";
import { category, summary } from "../lib/test-fixtures";
import { HomeSectionsView, pageHeadingId, type HomeContext } from "./home-sections";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

// The home page of design batch B (plan 2026-11-03-storefront-design-b.md, review D-18): sections from `config/home.ts`.

const t = sentinelTranslator();
const context: HomeContext = { locale: "uk", t, imageHosts: ["cdn.example.com"] };

const hero: HeroSection = {
  kind: "hero",
  id: "hero",
  headlineKey: "h.title",
  sublineKey: "h.sub",
  cta: { labelKey: "h.cta", href: "/catalog" },
  image: { src: "/home/hero.svg", width: 640, height: 480, altKey: null },
};
const tiles: CategoriesSection = { kind: "categories", id: "tiles", titleKey: "c.title", limit: 2 };
const row: ProductRowSection = {
  kind: "productRow",
  id: "row",
  titleKey: "p.title",
  limit: 8,
  source: { sort: "newest" },
  viewAll: { labelKey: "p.all" },
};
const trust: TrustSection = { kind: "trust", id: "trust", titleKey: "t.title" };
const about: RichTextSection = {
  kind: "richText",
  id: "about",
  titleKey: "a.title",
  bodyKey: "a.body",
};

const loaded: Record<string, HomeSectionResult> = {
  tiles: {
    status: "ok",
    data: {
      kind: "categories",
      categories: [
        category("clothing", [category("tops"), category("shirts")], { name: "§clothing" }),
        category("books", [], { name: "§books" }),
      ],
    },
  },
  row: {
    status: "ok",
    data: {
      kind: "productRow",
      products: [summary("a", { title: "§a" }), summary("b", { title: "§b" })],
      exponent: 2,
    },
  },
};

function render(
  sections: readonly HomeSection[],
  results = loaded,
  extra: Partial<HomeContext> = {},
) {
  return renderToStaticMarkup(
    <HomeSectionsView sections={sections} context={{ ...context, ...extra }} results={results} />,
  );
}

function sectionOrder(html: string): string[] {
  return [...html.matchAll(/data-home-section-id="([^"]+)"/g)].map((match) => match[1] as string);
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h([1-6])[ >]/g)].map((match) => `h${match[1]}`);
}

describe("home sections from config", () => {
  const html = render([hero, tiles, row, trust, about]);

  it("renders the sections in the configured order", () => {
    expect(html.indexOf("§h.title")).toBeLessThan(html.indexOf("§c.title"));
    expect(sectionOrder(html)).toEqual(["tiles", "row", "trust", "about"]);
  });

  it("follows the config: another order gives another page", () => {
    expect(sectionOrder(render([about, row, tiles]))).toEqual(["about", "row", "tiles"]);
  });

  it("has one h1 (the first hero) and a sound outline: h2 per section, h3 per product", () => {
    expect(headings(html)).toEqual(["h1", "h2", "h2", "h3", "h3", "h2", "h2"]);
    expect(html).toMatch(/<h1 id="hero-title"[^>]*>§h.title<\/h1>/);
    expect(html).toMatch(
      /<section aria-labelledby="trust-title"[^>]*><h2 id="trust-title" class="sr-only">/,
    );
  });

  it("keeps one h1 when the first section is not a hero: a visually hidden one, and heroes become h2", () => {
    const later = render([row, hero]);
    expect(pageHeadingId([row, hero])).toBeNull();
    expect(headings(later)).toEqual(["h1", "h2", "h3", "h3", "h2"]);
    expect(later).toContain('<h1 class="sr-only">§site.name</h1>');
    expect(later).toMatch(/<h2 id="hero-title"/);
    expect(render([])).toBe(
      '<div class="flex flex-col gap-12 py-8"><h1 class="sr-only">§site.name</h1></div>',
    );
  });

  it("loads the first hero's picture at once with its size; a later hero's lazily", () => {
    const first = /<img alt=""[^>]*src="\/home\/hero.svg"\/>/.exec(html)?.[0] ?? "";
    expect(first).toContain('fetchPriority="high"');
    expect(first).toContain('loading="eager"');
    expect(first).toContain('width="640" height="480"');
    const later = /<img alt=""[^>]*src="\/home\/hero.svg"\/>/.exec(render([row, hero]))?.[0] ?? "";
    expect(later).toContain('loading="lazy"');
    expect(later).not.toContain('fetchPriority="high"');
  });

  it("links the call to action, the category tiles and the row's full list", () => {
    expect(html).toContain('href="/uk/catalog"');
    expect(html).toContain('href="/uk/c/clothing"');
    expect(html).toContain('href="/uk/c/books"');
    expect(html).toContain('href="/uk/p/a"');
  });

  it("counts the subcategories of a tile with a plural, and says nothing for none", () => {
    expect(html).toContain("§home.categoryTiles.subcategories:2");
    expect(html.match(/home\.categoryTiles\.subcategories/g)).toHaveLength(1);
  });

  it("loads no product image of the home rows eagerly (they sit below the hero)", () => {
    const rowHtml = html.slice(html.indexOf('data-home-section-id="row"'));
    expect(rowHtml).not.toContain('loading="eager"');
  });

  it("splits the rich text into paragraphs on blank lines", () => {
    const paragraphs = renderToStaticMarkup(
      <HomeSectionsView
        sections={[about]}
        context={{
          ...context,
          t: Object.assign((key: string) => (key === "a.body" ? "§one\n\n§two" : `§${key}`), {
            plural: t.plural,
          }),
        }}
        results={{}}
      />,
    );
    expect(paragraphs.match(/<p class="whitespace-pre-line">/g)).toHaveLength(2);
  });

  it("has no hardcoded text", () => {
    const withoutPrices = html.replace(/[\d\s,]+₴|₴/g, " ");
    expect(leftoverText(withoutPrices)).toBe("");
    for (const value of textAttributes(html)) {
      expect(value === "" || value.startsWith("§"), value).toBe(true);
    }
  });
});

describe("home data sections: empty, error and loading", () => {
  it("leaves out a data section with nothing to show (no categories, no products)", () => {
    const html = render([hero, tiles, row], {
      tiles: { status: "ok", data: { kind: "categories", categories: [] } },
      row: { status: "ok", data: { kind: "productRow", products: [], exponent: 2 } },
    });
    expect(sectionOrder(html)).toEqual([]);
    expect(html).not.toContain("§c.title");
    expect(html).not.toContain("§p.title");
  });

  it("leaves out the trust section when the trust bar lists nothing", () => {
    expect(sectionOrder(render([trust], {}, { trustItems: [] }))).toEqual([]);
    expect(sectionOrder(render([trust]))).toEqual(["trust"]);
  });

  it("shows a short error under the heading of a section whose read failed, and the rest of the page", () => {
    const html = render([hero, tiles, row], {
      tiles: { status: "error" },
      row: loaded.row as HomeSectionResult,
    });
    expect(sectionOrder(html)).toEqual(["tiles", "row"]);
    expect(html).toMatch(/<h2 id="tiles-title"[^>]*>§c.title<\/h2>/);
    expect(html).toContain("§home.section.error");
    expect(html).toContain('href="/uk/p/a"');
  });

  it("shows a skeleton of the section's size while it loads, marked busy, with its heading", () => {
    const html = render([tiles, row], {});
    expect(html.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(html).toContain("§c.title");
    expect(html).toContain("§loading.page");
    // The tiles: as many boxes as the section's limit; the row: up to two rows of four.
    expect(html.match(/aspect-video/g)).toHaveLength(2);
    // A config limit above a row still shows one row of tile skeletons.
    expect(render([{ ...tiles, limit: 6 }], {}).match(/aspect-video/g)).toHaveLength(3);
    expect(html.match(/aspect-square/g)).toHaveLength(8);
  });
});

describe("the default home config renders", () => {
  it("as hero, categories, products, trust and the about text", () => {
    const results: Record<string, HomeSectionResult> = {
      "home-categories": loaded.tiles as HomeSectionResult,
      "home-new-products": loaded.row as HomeSectionResult,
    };
    const html = render(homeSections, results);
    expect(sectionOrder(html)).toEqual([
      "home-categories",
      "home-new-products",
      "home-trust",
      "home-about",
    ]);
    expect(html).toContain('src="/home/hero.svg"');
    expect(headings(html)[0]).toBe("h1");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HomeBanner } from "@fluxkit/api-client";
import {
  homeSections,
  type AdminBannersSection,
  type Banner,
  type BannerTone,
  type ConfigBannersSection,
  type CategoriesSection,
  type HeroSection,
  type HomeSection,
  type ProductRowSection,
  type RichTextSection,
  type TrustSection,
} from "../config/home";
import { storeBannerViews } from "../lib/home-banners";
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

describe("home banners", () => {
  const card = (id: string, href: string, tone?: BannerTone): Banner => ({
    id,
    titleKey: `${id}.title`,
    textKey: `${id}.text`,
    href,
    image: { src: "/home/banner-1.svg", width: 640, height: 320, altKey: `${id}.alt` },
    ...(tone === undefined ? {} : { tone }),
  });
  const banners: ConfigBannersSection = {
    kind: "banners",
    source: "config",
    id: "promo",
    titleKey: "b.title",
    items: [
      card("one", "/catalog", "accent"),
      card("two", "https://example.com/sale"),
      card("three", "/account/register", "surface"),
    ],
  };
  const html = render([hero, banners, tiles]);
  const items = (markup: string) =>
    [...markup.matchAll(/<li data-banner-id="[^"]+"[^>]*>.*?<\/li>/g)].map((match) => match[0]);

  it("renders a labelled section with a visually hidden h2 and one h3 per card, after the hero", () => {
    expect(sectionOrder(html)).toEqual(["promo", "tiles"]);
    expect(html).toMatch(
      /<section aria-labelledby="promo-title" data-home-section="banners"[^>]*><h2 id="promo-title" class="sr-only">§b.title<\/h2>/,
    );
    expect(headings(html).slice(0, 5)).toEqual(["h1", "h2", "h3", "h3", "h3"]);
  });

  it("makes each whole card ONE link, named by its title and described by its text", () => {
    const cards = items(html);
    expect(cards).toHaveLength(3);
    for (const [index, id] of ["one", "two", "three"].entries()) {
      const markup = cards[index] as string;
      expect(markup.match(/<a /g), id).toHaveLength(1);
      expect(markup).toContain(`aria-labelledby="promo-${id}-title"`);
      expect(markup).toContain(`aria-describedby="promo-${id}-text"`);
      expect(markup).toMatch(new RegExp(`<h3 id="promo-${id}-title"[^>]*>§${id}.title</h3>`));
      expect(markup).toMatch(new RegExp(`<span id="promo-${id}-text"[^>]*>§${id}.text</span>`));
      expect(markup).toContain(`alt="§${id}.alt"`);
      expect(markup).toContain('width="640" height="320"');
    }
    expect(cards[0]).toContain('href="/uk/catalog"');
    expect(cards[1]).toContain('href="https://example.com/sale"');
    expect(cards[1]).not.toContain("target=");
    expect(cards[2]).toContain('href="/uk/account/register"');
  });

  it("colours a card from tokens only: accent is the primary colour, surface (the default) the page background", () => {
    const [accent, plain, surface] = items(html) as [string, string, string];
    expect(accent).toContain("bg-primary text-primary-foreground");
    expect(plain).toContain("bg-background text-foreground");
    expect(surface).toContain("bg-background text-foreground");
  });

  it("lays the cards out in one column on phones and up to three from md", () => {
    expect(html).toContain('<ul class="grid gap-4 grid-cols-1 md:grid-cols-3">');
    const two = render([{ ...banners, items: [card("a", "/"), card("b", "/catalog")] }]);
    expect(two).toContain('<ul class="grid gap-4 grid-cols-1 md:grid-cols-2">');
    const one = render([{ ...banners, items: [card("a", "/")] }]);
    expect(one).toContain('<ul class="grid gap-4 grid-cols-1">');
  });

  it("loads the pictures lazily below the first section, and at once when the banners come first", () => {
    for (const markup of items(html)) {
      expect(markup).toContain('loading="lazy"');
      expect(markup).not.toContain('fetchPriority="high"');
    }
    const first = render([banners, hero]);
    for (const markup of items(first)) expect(markup).toContain('loading="eager"');
    // Without a hero first, the page keeps one (hidden) h1.
    expect(headings(first)[0]).toBe("h1");
  });

  it("hides the section when the list is empty", () => {
    const empty = render([hero, { ...banners, items: [] }]);
    expect(sectionOrder(empty)).toEqual([]);
    expect(empty).not.toContain("§b.title");
  });

  it("refuses an unsafe link or a fourth banner on render (fails loudly)", () => {
    expect(() => render([{ ...banners, items: [card("x", "javascript:alert(1)")] }])).toThrow();
    expect(() => render([{ ...banners, items: [card("x", "http://example.com/")] }])).toThrow();
    const four = [card("a", "/"), card("b", "/"), card("c", "/"), card("d", "/")];
    expect(() => render([{ ...banners, items: four } as unknown as ConfigBannersSection])).toThrow(
      /at most 3/,
    );
  });

  it("frames every picture at 2:1 with object-cover, so any picture keeps its box (no layout shift)", () => {
    for (const markup of items(html)) {
      expect(markup).toContain('<span class="block aspect-2/1 overflow-hidden bg-muted"><img');
      expect(markup).toContain('class="h-full w-full object-cover"');
    }
  });

  it("has no hardcoded text", () => {
    expect(leftoverText(html.replace(/[\d\s,]+₴|₴/g, " "))).toBe("");
    for (const value of textAttributes(html)) {
      expect(value === "" || value.startsWith("§"), value).toBe(true);
    }
  });
});

describe("home banners of the admin (source admin)", () => {
  const adminBanners: AdminBannersSection = {
    kind: "banners",
    source: "admin",
    id: "promo",
    titleKey: "b.title",
  };
  const hosts = ["media.example.com"];
  const url = (letter: string) => `https://media.example.com/${letter.repeat(32)}.webp`;
  const apiBanner = (id: string, overrides: Partial<HomeBanner> = {}): HomeBanner => ({
    id,
    layout: "card",
    title: `§${id}.title`,
    text: `§${id}.text`,
    href: "/catalog",
    tone: "surface",
    image: { url: url("a"), width: 1200, height: 500, alt: null },
    ...overrides,
  });
  const ids = {
    one: "11111111-1111-4111-8111-111111111111",
    two: "22222222-2222-4222-8222-222222222222",
    three: "33333333-3333-4333-8333-333333333333",
  };
  const answer = [
    apiBanner(ids.one, {
      tone: "accent",
      image: { url: url("b"), width: 1280, height: 640, alt: "§one.alt" },
    }),
    apiBanner(ids.two, { text: null, href: "https://example.com/sale" }),
    apiBanner(ids.three, {
      layout: "image",
      title: null,
      text: null,
      href: "/account/register",
      image: { url: url("c"), width: 1280, height: 640, alt: "§three.alt" },
    }),
  ];
  const ok = (banners: readonly HomeBanner[], extraWarn = () => undefined): HomeSectionResult => ({
    status: "ok",
    data: { kind: "banners", banners: storeBannerViews(banners, "uk", hosts, extraWarn) },
  });
  const html = render([hero, adminBanners, tiles], { ...loaded, promo: ok(answer) });
  const items = (markup: string) =>
    [...markup.matchAll(/<li data-banner-id="[^"]+"[^>]*>.*?<\/li>/g)].map((match) => match[0]);

  it("renders the banners of the API after the hero: a hidden h2, an h3 per card, none for the picture banner", () => {
    expect(sectionOrder(html)).toEqual(["promo", "tiles"]);
    expect(html).toMatch(/<h2 id="promo-title" class="sr-only">§b.title<\/h2>/);
    expect(headings(html).slice(0, 4)).toEqual(["h1", "h2", "h3", "h3"]);
    expect(items(html)).toHaveLength(3);
    expect(html).toContain('<ul class="grid gap-4 grid-cols-1 md:grid-cols-3">');
  });

  it("draws a card with its title, text and tone; its text is optional; the picture is decorative without alt text", () => {
    const [one, two] = items(html) as [string, string];
    expect(one).toContain('data-banner-layout="card"');
    expect(one).toContain(`aria-labelledby="promo-${ids.one}-title"`);
    expect(one).toContain(`aria-describedby="promo-${ids.one}-text"`);
    expect(one).toContain("bg-primary text-primary-foreground");
    expect(one).toContain('href="/uk/catalog"');
    expect(one).toContain('alt="§one.alt"');
    expect(two).toContain('href="https://example.com/sale"');
    expect(two).not.toContain("aria-describedby");
    expect(two).not.toContain(`promo-${ids.two}-text`);
    expect(two).toContain('alt=""');
    expect(two).toContain("bg-background text-foreground");
  });

  it("draws the image layout as the picture alone, one link named by its alt text, no text and no tone", () => {
    const three = items(html)[2] as string;
    expect(three).toContain('data-banner-layout="image"');
    expect(three.match(/<a /g)).toHaveLength(1);
    expect(three).toContain('href="/uk/account/register"');
    expect(three).toContain('alt="§three.alt"');
    expect(three).not.toContain("aria-labelledby");
    expect(three).not.toMatch(/<h3|bg-primary|§three\.title/);
  });

  it("puts every picture in the 2:1 frame with its API size, whatever the upload's own ratio", () => {
    for (const markup of items(html)) {
      expect(markup).toContain('<span class="block aspect-2/1 overflow-hidden bg-muted">');
      expect(markup).toContain("h-full w-full object-cover");
    }
    expect(items(html)[1]).toContain('width="1200" height="500"');
  });

  it("serves the picture URL the API chose for the locale (its own picture, else the default)", () => {
    expect(items(html)[0]).toContain(encodeURIComponent(url("b")));
    expect(items(html)[2]).toContain(encodeURIComponent(url("c")));
  });

  it("loads the pictures lazily below the hero and at once when the banners come first", () => {
    for (const markup of items(html)) expect(markup).toContain('loading="lazy"');
    const first = render([adminBanners, hero], { promo: ok(answer) });
    for (const markup of items(first)) expect(markup).toContain('loading="eager"');
  });

  it("shows the token placeholder for a picture whose host is not allowed (named for the image layout)", () => {
    const placeholder = render([adminBanners], {
      promo: {
        status: "ok",
        data: { kind: "banners", banners: storeBannerViews(answer, "uk", [], () => undefined) },
      },
    });
    expect(placeholder).not.toContain("<img");
    expect(placeholder).toContain('role="img" aria-label="§three.alt"');
    expect(placeholder).toContain('aria-hidden="true"');
  });

  it("hides the section when there is no banner, when the read failed, and while it has no result", () => {
    for (const result of [ok([]), { status: "error" } as const]) {
      const markup = render([hero, adminBanners, tiles], { ...loaded, promo: result });
      expect(sectionOrder(markup)).toEqual(["tiles"]);
      expect(markup).not.toContain("§b.title");
      expect(markup).not.toContain("§home.section.error");
    }
    const loading = render([hero, adminBanners], {});
    expect(sectionOrder(loading)).toEqual([]);
    expect(loading).not.toContain('aria-busy="true"');
  });

  it("leaves out a banner the storefront refuses and shows the rest", () => {
    const markup = render([adminBanners], {
      promo: ok([apiBanner(ids.one, { href: "/%2e%2e/admin" }), answer[1] as HomeBanner]),
    });
    expect(items(markup)).toHaveLength(1);
    expect(markup).toContain('<ul class="grid gap-4 grid-cols-1">');
  });

  it("has no hardcoded text", () => {
    expect(leftoverText(html.replace(/[\d\s,]+₴|₴/g, " "))).toBe("");
    for (const value of textAttributes(html)) {
      expect(value === "" || value.startsWith("§"), value).toBe(true);
    }
  });
});

describe("the default home config renders", () => {
  it("as hero, banners, categories, products, trust and the about text", () => {
    const results: Record<string, HomeSectionResult> = {
      "home-banners": {
        status: "ok",
        data: {
          kind: "banners",
          banners: storeBannerViews(
            [
              {
                id: "11111111-1111-4111-8111-111111111111",
                layout: "card",
                title: "§t",
                text: null,
                href: "/catalog",
                tone: "accent",
                image: { url: "https://cdn.example.com/x.webp", width: 2, height: 1, alt: null },
              },
            ],
            "uk",
            ["cdn.example.com"],
          ),
        },
      },
      "home-categories": loaded.tiles as HomeSectionResult,
      "home-new-products": loaded.row as HomeSectionResult,
    };
    const html = render(homeSections, results);
    expect(sectionOrder(html)).toEqual([
      "home-banners",
      "home-categories",
      "home-new-products",
      "home-trust",
      "home-about",
    ]);
    expect(html).toContain('src="/home/hero.svg"');
    expect(headings(html)[0]).toBe("h1");
  });
});

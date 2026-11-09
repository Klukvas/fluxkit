import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { messagesByLocale } from "../messages";
import {
  homeMetadata,
  listingMetadata,
  privateMetadata,
  productMetadata,
  searchMetadata,
  shopPageMetadata,
} from "./page-metadata";
import { product } from "./test-fixtures";

const { uk } = messagesByLocale;
/** The shop name of the merged messages (a fork renames it in `messages-overrides`): never a literal here (plan B3). */
const shopName = uk["site.name"] as string;

const t = createTranslator(uk, "uk");
const origin = "https://shop.example";

function listing(query: { page: number; brand: string | null }, basePath = "/catalog") {
  return listingMetadata({
    origin,
    locale: "uk",
    t,
    basePath,
    query,
    title: "Каталог",
    description: "Опис",
  });
}

describe("listingMetadata", () => {
  it("indexes page 1 of an unfiltered listing, with a self canonical and hreflang for both locales", () => {
    const meta = listing({ page: 1, brand: null });
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates).toEqual({
      canonical: "https://shop.example/uk/catalog",
      languages: {
        uk: "https://shop.example/uk/catalog",
        en: "https://shop.example/en/catalog",
        "x-default": "https://shop.example/uk/catalog",
      },
    });
    expect(meta.title).toBe(`Каталог — ${shopName}`);
    expect(meta.description).toBe("Опис");
  });

  it("marks a brand-filtered view noindex, follow and points the canonical at the UNFILTERED page", () => {
    const meta = listing({ page: 1, brand: "acme" });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(JSON.stringify(meta.alternates)).not.toContain("brand");
    expect(meta.alternates?.canonical).toBe("https://shop.example/uk/catalog");
    expect(JSON.stringify(meta)).not.toContain("acme");
  });

  it("keeps the page in the canonical of page 2 (a self canonical, not page 1) and marks it noindex, follow", () => {
    const meta = listing({ page: 2, brand: null }, "/c/shoes");
    expect(meta.alternates?.canonical).toBe("https://shop.example/uk/c/shoes?page=2");
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.title).toBe(`Каталог (Сторінка 2) — ${shopName}`);
  });

  it("drops the brand but keeps the page for a filtered later page", () => {
    const meta = listing({ page: 3, brand: "acme" });
    expect(meta.alternates?.canonical).toBe("https://shop.example/uk/catalog?page=3");
  });

  it("repeats title and description in Open Graph with the canonical URL", () => {
    const meta = listing({ page: 1, brand: null });
    expect(meta.openGraph).toMatchObject({
      title: `Каталог — ${shopName}`,
      description: "Опис",
      url: "https://shop.example/uk/catalog",
      siteName: shopName,
    });
  });

  it("omits the description when there is none", () => {
    const meta = listingMetadata({
      origin,
      locale: "uk",
      t,
      basePath: "/catalog",
      query: { page: 1, brand: null },
      title: "Каталог",
      description: undefined,
    });
    expect(meta).not.toHaveProperty("description");
  });
});

describe("productMetadata", () => {
  it("builds title, trimmed description, canonical, hreflang and an Open Graph image from the product", () => {
    const meta = productMetadata({
      origin,
      locale: "en",
      t: createTranslator({ ...uk, "seo.pageTitle": "{title} | {site}" }, "en"),
      product: product({
        title: "Demo product",
        description: "  A   demo\n product.  ",
        media: [{ url: "https://cdn.example.com/a.jpg", alt: "Front view", optionValueId: null }],
      }),
    });
    expect(meta.title).toBe(`Demo product | ${shopName}`);
    expect(meta.description).toBe("A demo product.");
    expect(meta.alternates).toEqual({
      canonical: "https://shop.example/en/p/demo-product",
      languages: {
        uk: "https://shop.example/uk/p/demo-product",
        en: "https://shop.example/en/p/demo-product",
        "x-default": "https://shop.example/uk/p/demo-product",
      },
    });
    expect(meta.openGraph).toMatchObject({
      title: `Demo product | ${shopName}`,
      url: "https://shop.example/en/p/demo-product",
      images: [{ url: "https://cdn.example.com/a.jpg", alt: "Front view" }],
    });
    expect(meta.robots).toBeUndefined();
  });

  it("falls back to the title for the description and leaves out an unusable image", () => {
    const meta = productMetadata({
      origin,
      locale: "uk",
      t,
      product: product({
        title: "Назва",
        description: null,
        media: [{ url: "javascript:alert(1)", alt: null, optionValueId: null }],
      }),
    });
    expect(meta.description).toBe("Назва");
    expect(meta.openGraph).not.toHaveProperty("images");
  });

  it("encodes the slug in the canonical", () => {
    const meta = productMetadata({ origin, locale: "uk", t, product: product({ slug: "a b" }) });
    expect(meta.alternates?.canonical).toBe("https://shop.example/uk/p/a%20b");
  });
});

describe("homeMetadata", () => {
  it("gives the home page a locale root canonical and both hreflang URLs", () => {
    expect(homeMetadata({ origin, locale: "en", t }).alternates).toEqual({
      canonical: "https://shop.example/en",
      languages: {
        uk: "https://shop.example/uk",
        en: "https://shop.example/en",
        "x-default": "https://shop.example/uk",
      },
    });
  });
});

describe("the brand's default social picture (config/brand.ts ogImage, plan B1)", () => {
  const ogImage = { src: "/brand/og.png", width: 1200, height: 630 } as const;
  const expected = [
    { url: "https://shop.example/brand/og.png", width: 1200, height: 630, alt: shopName },
  ];

  it("adds nothing with the template's default config (no og:image, the home page keeps no openGraph)", () => {
    expect(homeMetadata({ origin, locale: "uk", t })).not.toHaveProperty("openGraph");
    expect(listing({ page: 1, brand: null }).openGraph).not.toHaveProperty("images");
    expect(
      productMetadata({ origin, locale: "uk", t, product: product({ media: [] }) }).openGraph,
    ).not.toHaveProperty("images");
  });

  it("is added, absolute, to every page that writes its own openGraph (Next replaces the layout's instead of merging)", () => {
    expect(homeMetadata({ origin, locale: "uk", t, ogImage }).openGraph).toEqual({
      images: expected,
    });
    const list = listingMetadata({
      origin,
      locale: "uk",
      t,
      basePath: "/catalog",
      query: { page: 1, brand: null },
      title: "Каталог",
      description: "Опис",
      ogImage,
    });
    expect(list.openGraph).toMatchObject({ siteName: shopName, images: expected });
    const page = shopPageMetadata({
      origin,
      locale: "uk",
      t,
      titleKey: "shopPages.returns.title",
      descriptionKey: "shopPages.returns.description",
      slug: "returns",
      ogImage,
    });
    expect(page.openGraph).toMatchObject({ images: expected });
  });

  it("stands in for a product without a usable picture, never for a product's own", () => {
    const bare = productMetadata({
      origin,
      locale: "uk",
      t,
      ogImage,
      product: product({ media: [{ url: "javascript:x", alt: null, optionValueId: null }] }),
    });
    expect(bare.openGraph).toMatchObject({ images: expected });
    const own = productMetadata({
      origin,
      locale: "uk",
      t,
      ogImage,
      product: product({
        title: "Назва",
        media: [{ url: "https://cdn.example.com/a.jpg", alt: null, optionValueId: null }],
      }),
    });
    expect(own.openGraph).toMatchObject({
      images: [{ url: "https://cdn.example.com/a.jpg", alt: "Назва" }],
    });
  });
});

describe("privateMetadata (cart, checkout, account, orders)", () => {
  it("is noindex AND nofollow, with a title and no canonical or alternates", () => {
    const meta = privateMetadata(t, "cart.title");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(String(meta.title)).toContain(uk["cart.title"]);
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
  });
});

describe("searchMetadata", () => {
  const query = {
    q: "викрутка",
    facets: ["brand:acme"],
    price: null,
    sort: null,
    page: 2,
  } as const;

  it("is noindex, follow on every state of the results page (a search result is not a page to rank)", () => {
    expect(searchMetadata({ origin, locale: "uk", t, query }).robots).toEqual({
      index: false,
      follow: true,
    });
    expect(
      searchMetadata({
        origin,
        locale: "uk",
        t,
        query: { q: "", facets: [], price: null, sort: null, page: 1 },
      }).robots,
    ).toEqual({ index: false, follow: true });
  });

  it("points the canonical at the words alone: filters, sort and page are dropped, and the locale and words are encoded", () => {
    const meta = searchMetadata({ origin, locale: "uk", t, query });
    expect(meta.alternates).toEqual({
      canonical:
        "https://shop.example/uk/search?q=%D0%B2%D0%B8%D0%BA%D1%80%D1%83%D1%82%D0%BA%D0%B0",
    });
    expect(
      searchMetadata({ origin, locale: "en", t, query: { ...query, q: "" } }).alternates?.canonical,
    ).toBe("https://shop.example/en/search");
  });

  it("puts the words in the title as plain text, and nothing of the address in the description", () => {
    const meta = searchMetadata({ origin, locale: "uk", t, query: { ...query, q: "<b>x</b>" } });
    expect(String(meta.title)).toContain("<b>x</b>");
    expect(String(meta.title)).toContain(t("search.title"));
    expect(meta.description).toBe(t("search.metaDescription"));
    expect(searchMetadata({ origin, locale: "uk", t, query: { ...query, q: "" } }).title).toBe(
      t("seo.pageTitle", { title: t("search.title"), site: t("site.name") }),
    );
  });
});

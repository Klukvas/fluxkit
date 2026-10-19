import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import uk from "../messages/uk.json";
import { homeMetadata, listingMetadata, productMetadata } from "./page-metadata";
import { product } from "./test-fixtures";

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
    expect(meta.title).toBe("Каталог — Fluxkit");
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
    expect(meta.title).toBe("Каталог (Сторінка 2) — Fluxkit");
  });

  it("drops the brand but keeps the page for a filtered later page", () => {
    const meta = listing({ page: 3, brand: "acme" });
    expect(meta.alternates?.canonical).toBe("https://shop.example/uk/catalog?page=3");
  });

  it("repeats title and description in Open Graph with the canonical URL", () => {
    const meta = listing({ page: 1, brand: null });
    expect(meta.openGraph).toMatchObject({
      title: "Каталог — Fluxkit",
      description: "Опис",
      url: "https://shop.example/uk/catalog",
      siteName: "Fluxkit",
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
    expect(meta.title).toBe("Demo product | Fluxkit");
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
      title: "Demo product | Fluxkit",
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
    expect(homeMetadata({ origin, locale: "en" }).alternates).toEqual({
      canonical: "https://shop.example/en",
      languages: {
        uk: "https://shop.example/uk",
        en: "https://shop.example/en",
        "x-default": "https://shop.example/uk",
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  languageAlternates,
  listingRobots,
  productJsonLd,
  schemaAvailability,
  serializeJsonLd,
  trimDescription,
} from "./seo";
import { option, product, variant } from "./test-fixtures";

const origin = "https://shop.example";

describe("absoluteUrl", () => {
  it("joins the origin and a path that starts with one slash", () => {
    expect(absoluteUrl(origin, "/uk/catalog")).toBe("https://shop.example/uk/catalog");
    expect(absoluteUrl(origin, "/uk")).toBe("https://shop.example/uk");
  });
  it("refuses a path that could change the host", () => {
    expect(() => absoluteUrl(origin, "//evil.example")).toThrow(RangeError);
    expect(() => absoluteUrl(origin, "evil.example")).toThrow(RangeError);
    expect(() => absoluteUrl(origin, "https://evil.example")).toThrow(RangeError);
  });
});

describe("languageAlternates", () => {
  const input = { origin, locales: ["uk", "en"], defaultLocale: "uk" } as const;

  it("builds the canonical of the current locale and a hreflang per locale plus x-default", () => {
    expect(languageAlternates({ ...input, locale: "en", path: "/catalog" })).toEqual({
      canonical: "https://shop.example/en/catalog",
      languages: {
        uk: "https://shop.example/uk/catalog",
        en: "https://shop.example/en/catalog",
        "x-default": "https://shop.example/uk/catalog",
      },
    });
  });

  it("uses the locale root for the home page", () => {
    expect(languageAlternates({ ...input, locale: "uk", path: "" }).canonical).toBe(
      "https://shop.example/uk",
    );
  });

  it("keeps a page query but never a brand: the canonical of a filtered view is the unfiltered one", () => {
    const result = languageAlternates({ ...input, locale: "uk", path: "/catalog?page=2" });
    expect(result.canonical).toBe("https://shop.example/uk/catalog?page=2");
    expect(result.languages.en).toBe("https://shop.example/en/catalog?page=2");
    expect(() =>
      languageAlternates({ ...input, locale: "uk", path: "/catalog?brand=acme&page=2" }),
    ).toThrow(/brand/);
  });
});

describe("listingRobots", () => {
  it("indexes page 1 of an unfiltered listing (no robots directive at all)", () => {
    expect(listingRobots({ page: 1, brand: null })).toBeUndefined();
  });
  it("marks a filtered view noindex, follow, on any page", () => {
    expect(listingRobots({ page: 1, brand: "acme" })).toEqual({ index: false, follow: true });
    expect(listingRobots({ page: 3, brand: "acme" })).toEqual({ index: false, follow: true });
  });
  it("marks later pages noindex, follow (page 1 is the indexable entry; products are in the sitemap)", () => {
    expect(listingRobots({ page: 2, brand: null })).toEqual({ index: false, follow: true });
  });
});

describe("trimDescription", () => {
  it("returns undefined for nothing", () => {
    expect(trimDescription(null)).toBeUndefined();
    expect(trimDescription("   \n ")).toBeUndefined();
  });
  it("collapses whitespace and keeps short text whole", () => {
    expect(trimDescription("A  basic\n\ncotton   T-shirt.")).toBe("A basic cotton T-shirt.");
  });
  it("cuts long text at a word boundary within the limit and adds an ellipsis", () => {
    const text = "word ".repeat(100);
    const result = trimDescription(text, 40) as string;
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toMatch(/wor…$/);
  });
  it("does not split a surrogate pair", () => {
    const result = trimDescription("😀".repeat(100), 11) as string;
    expect(result.endsWith("…")).toBe(true);
    expect([...result].every((char) => char !== "\ufffd")).toBe(true);
    expect(() => encodeURIComponent(result)).not.toThrow();
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so no string can close the script element", () => {
    const text = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(text).toContain("\\u003c/script");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
  it("also escapes > & and the line separators, and round-trips every value", () => {
    const value = { a: "x > y & z\u2028\u2029", b: ["<!--"] };
    const text = serializeJsonLd(value);
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual(value);
  });
});

describe("schemaAvailability", () => {
  it("maps the API's statuses to schema.org", () => {
    expect(schemaAvailability("in_stock")).toBe("https://schema.org/InStock");
    expect(schemaAvailability("low_stock")).toBe("https://schema.org/LimitedAvailability");
    expect(schemaAvailability("out_of_stock")).toBe("https://schema.org/OutOfStock");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the items from 1 with absolute URLs", () => {
    expect(
      breadcrumbJsonLd([
        { name: "Home", url: "https://shop.example/uk" },
        { name: "Shoes", url: "https://shop.example/uk/c/shoes" },
      ]),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://shop.example/uk" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Shoes",
          item: "https://shop.example/uk/c/shoes",
        },
      ],
    });
  });
});

describe("productJsonLd", () => {
  const url = "https://shop.example/uk/p/demo-product";

  function offerOf(overrides: Parameters<typeof product>[0], exponent = 2) {
    const result = productJsonLd({
      product: product(overrides),
      url,
      exponent,
      images: [],
      description: undefined,
    }) as { offers: Record<string, unknown> };
    return result.offers;
  }

  it("describes one price as an Offer with a decimal STRING built from minor units", () => {
    expect(offerOf({ price: { from: 1999, to: 1999, currency: "UAH" } })).toMatchObject({
      "@type": "Offer",
      price: "19.99",
      priceCurrency: "UAH",
      availability: "https://schema.org/InStock",
      url,
    });
  });

  it("keeps trailing zeros and small amounts exact (no float division)", () => {
    expect(offerOf({ price: { from: 10, to: 10, currency: "UAH" } }).price).toBe("0.10");
    expect(offerOf({ price: { from: 1050, to: 1050, currency: "UAH" } }).price).toBe("10.50");
    expect(offerOf({ price: { from: 5, to: 5, currency: "UAH" } }).price).toBe("0.05");
    expect(offerOf({ price: { from: 1999, to: 1999, currency: "JPY" } }, 0).price).toBe("1999");
    expect(offerOf({ price: { from: 1999, to: 1999, currency: "KWD" } }, 3).price).toBe("1.999");
    expect(
      offerOf({ price: { from: 1_000_000_000_000, to: 1_000_000_000_000, currency: "UAH" } }).price,
    ).toBe("10000000000.00");
  });

  it("describes a price range as an AggregateOffer with the low and high price and the variant count", () => {
    const offers = offerOf({
      price: { from: 1050, to: 2999, currency: "UAH" },
      availability: "low_stock",
      options: [option("flavor", ["a", "b"])],
      variants: [variant("a", { flavor: "a" }), variant("b", { flavor: "b" })],
    });
    expect(offers).toMatchObject({
      "@type": "AggregateOffer",
      lowPrice: "10.50",
      highPrice: "29.99",
      priceCurrency: "UAH",
      offerCount: 2,
      availability: "https://schema.org/LimitedAvailability",
    });
    expect(offers).not.toHaveProperty("price");
  });

  it("carries name, brand, description, images and the sku of a single-variant product", () => {
    const result = productJsonLd({
      product: product({
        title: "Demo",
        variants: [variant("v", {}, { sku: "SKU-1" })],
      }),
      url,
      exponent: 2,
      images: ["https://cdn.example/a.jpg"],
      description: "Short text",
    }) as Record<string, unknown>;
    expect(result).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Demo",
      description: "Short text",
      image: ["https://cdn.example/a.jpg"],
      sku: "SKU-1",
      brand: { "@type": "Brand", name: "§brand" },
      url,
    });
  });

  it("leaves out brand, image, description and sku when there are none", () => {
    const result = productJsonLd({
      product: product({
        brand: null,
        variants: [variant("a", {}), variant("b", {})],
      }),
      url,
      exponent: 2,
      images: [],
      description: undefined,
    }) as Record<string, unknown>;
    for (const key of ["brand", "image", "description", "sku"]) {
      expect(result, key).not.toHaveProperty(key);
    }
  });

  it("serializes a malicious title safely end to end", () => {
    const malicious = '</script><img src=x onerror="alert(1)">';
    const text = serializeJsonLd(
      productJsonLd({
        product: product({ title: malicious }),
        url,
        exponent: 2,
        images: [],
        description: malicious,
      }),
    );
    expect(text).not.toContain("</script");
    expect(text).not.toContain("<");
    expect((JSON.parse(text) as { name: string }).name).toBe(malicious);
  });
});

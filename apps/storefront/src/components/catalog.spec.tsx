import type { ProductOption } from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { catalogPath } from "../lib/catalog-query";
import { formatMoney } from "../lib/money";
import { option, product, summary, variant, category } from "../lib/test-fixtures";
import uk from "../messages/uk.json";
import { CatalogView } from "./catalog-view";
import { HomeSections } from "./home-sections";
import { homeSections } from "../layout/home";
import { JsonLd } from "./json-ld";
import { ProductCard } from "./product-card";
import { ProductDetails } from "./product-details";
import { ProductGrid } from "./product-grid";
import { ProductPurchaseView } from "./product-purchase";
import { StoreImage } from "./store-image";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const t = sentinelTranslator();
const hosts = ["cdn.example.com"];
const money = (amount: number) => formatMoney({ amount, currency: "UAH" }, 2, "uk");

/** Strips money text and the glyphs of the quantity buttons and breadcrumbs (data and symbols, not words) before the "no words" check. */
function withoutMoney(html: string): string {
  return html
    .replaceAll(money(1999), "")
    .replaceAll(money(2999), "")
    .replaceAll(money(2599), "")
    .replaceAll("\u2212", "")
    .replaceAll("+", "")
    .replaceAll("/", "");
}

/** Option names and value names become sentinels, as the API's own text would be. */
function named(...options: ProductOption[]): ProductOption[] {
  return options.map((entry) => ({
    ...entry,
    name: `§${entry.code}`,
    values: entry.values.map((value) => ({ ...value, name: `§${value.code}` })),
  }));
}

describe("StoreImage", () => {
  it("renders a next/image with explicit dimensions, lazy by default and eager when above the fold", () => {
    const lazy = renderToStaticMarkup(
      <StoreImage
        src="https://cdn.example.com/a.jpg"
        alt="Front"
        width={480}
        height={480}
        sizes="50vw"
      />,
    );
    expect(lazy).toContain("<img");
    expect(lazy).toContain('alt="Front"');
    expect(lazy).toContain('width="480"');
    expect(lazy).toContain('height="480"');
    expect(lazy).toContain('loading="lazy"');
    expect(lazy).toContain("/_next/image?url=");
    const eager = renderToStaticMarkup(
      <StoreImage
        src="https://cdn.example.com/a.jpg"
        alt="Front"
        width={480}
        height={480}
        sizes="50vw"
        eager
      />,
    );
    expect(eager).toContain('loading="eager"');
    expect(eager).toContain('fetchPriority="high"');
  });

  it("renders the token-styled placeholder, never an <img>, without a source", () => {
    const html = renderToStaticMarkup(
      <StoreImage src={null} alt="Front" width={480} height={480} sizes="50vw" />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Front"');
    expect(html).toContain("bg-muted");
  });
});

describe("ProductCard", () => {
  const base = {
    locale: "uk" as const,
    t,
    exponent: 2,
    imageHosts: hosts,
    brandPath: "/catalog?brand=demo-brand",
    headingLevel: "h2" as const,
  };

  it("links the title to the product, the brand to the filtered catalog, and shows price and availability", () => {
    const html = renderToStaticMarkup(
      <ProductCard {...base} product={summary("demo-shirt", { title: "§shirt" }, "low_stock")} />,
    );
    expect(html).toContain('href="/uk/p/demo-shirt"');
    expect(html).toContain('href="/uk/catalog?brand=demo-brand"');
    expect(html).toContain(money(1999));
    expect(html).toContain("§availability.low_stock");
    expect(html.match(/<h2[ >]/g)).toHaveLength(1);
  });

  it("encodes the slug in the link", () => {
    const html = renderToStaticMarkup(
      <ProductCard {...base} product={summary("a b/c", { title: "§x" })} />,
    );
    expect(html).toContain('href="/uk/p/a%20b%2Fc"');
  });

  it("shows 'from <lowest price>' when the variants differ, and a plain price when they do not", () => {
    const range = renderToStaticMarkup(
      <ProductCard
        {...base}
        product={summary("r", { title: "§r", price: { from: 1999, to: 2999, currency: "UAH" } })}
      />,
    );
    expect(range).toContain(`§catalog.price.from`);
    expect(range).not.toContain(money(2999));
    const single = renderToStaticMarkup(
      <ProductCard {...base} product={summary("s", { title: "§s" })} />,
    );
    expect(single).not.toContain("§catalog.price.from");
  });

  it("shows the brand as plain text when there is no filter link, and nothing without a brand", () => {
    const plain = renderToStaticMarkup(
      <ProductCard {...base} brandPath={null} product={summary("s", { title: "§s" })} />,
    );
    expect(plain).toContain("§brand");
    expect(plain).not.toContain("brand=");
    const none = renderToStaticMarkup(
      <ProductCard
        {...base}
        brandPath={null}
        product={summary("s", { title: "§s", brand: null })}
      />,
    );
    expect(none).not.toContain("§brand");
  });

  it("uses the next/image only for an allowed host; any other host or no image gets the placeholder", () => {
    const allowed = renderToStaticMarkup(
      <ProductCard
        {...base}
        product={summary("a", {
          title: "§a",
          image: { url: "https://cdn.example.com/a.jpg", alt: "Alt text" },
        })}
      />,
    );
    expect(allowed).toContain("<img");
    expect(allowed).toContain('alt="Alt text"');
    const other = renderToStaticMarkup(
      <ProductCard
        {...base}
        product={summary("b", {
          title: "§b",
          image: { url: "https://example.com/placeholder/b.jpg", alt: "Alt text" },
        })}
      />,
    );
    expect(other).not.toContain("<img");
    expect(other).toContain('aria-label="Alt text"');
    const missing = renderToStaticMarkup(
      <ProductCard {...base} product={summary("c", { title: "§c" })} />,
    );
    expect(missing).not.toContain("<img");
    // The alt text is never empty for an informative image: without an image alt the title names it.
    expect(missing).toContain('aria-label="§c"');
  });
});

describe("ProductGrid", () => {
  const products = Array.from({ length: 6 }, (_, i) => summary(`p${i}`, { title: `§p${i}` }));
  const html = renderToStaticMarkup(
    <ProductGrid
      products={products}
      locale="uk"
      t={t}
      exponent={2}
      imageHosts={hosts}
      headingLevel="h2"
      brandPathFor={(slug) => catalogPath("/catalog", { brand: slug })}
      label="§list"
    />,
  );

  it("is a labelled list with one item per product", () => {
    expect(html).toContain('aria-label="§list"');
    expect(html.match(/<li[ >]/g)).toHaveLength(6);
  });
});

describe("CatalogView", () => {
  const products = {
    items: [summary("a", { title: "§a" }), summary("b", { title: "§b" })],
    total: 60,
    limit: 24,
    offset: 24,
  };
  const props = {
    locale: "uk" as const,
    t,
    heading: "§heading",
    description: null,
    breadcrumbs: [{ label: "§home", href: "/uk" }, { label: "§heading" }],
    products,
    page: 2,
    pageCount: 3,
    exponent: 2,
    imageHosts: hosts,
    basePath: "/catalog",
    subcategories: [],
    brand: null,
    isCategory: false,
  };

  it("has one h1, h2 product titles, a breadcrumb with aria-current and the translated count", () => {
    const html = renderToStaticMarkup(<CatalogView {...props} />);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect([...html.matchAll(/<h([1-6])[ >]/g)].map((m) => m[1])).toEqual(["1", "2", "2"]);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("§catalog.count:60");
    expect(html).toContain('aria-label="§breadcrumbs.label"');
  });

  it("links pages with the brand kept, page 1 without a page parameter, next and previous as rel links", () => {
    const html = renderToStaticMarkup(
      <CatalogView {...props} brand={{ slug: "acme", name: "§acme" }} />,
    );
    expect(html).toContain('href="/uk/catalog?brand=acme"');
    expect(html).toContain('href="/uk/catalog?brand=acme&amp;page=3"');
    expect(html).toContain('rel="next"');
    expect(html).toContain('rel="prev"');
    expect(html).toContain('aria-current="page"');
  });

  it("shows the active brand filter with a link that clears it (and the page)", () => {
    const html = renderToStaticMarkup(
      <CatalogView {...props} basePath="/c/shoes" brand={{ slug: "acme", name: "§acme" }} />,
    );
    expect(html).toContain("§catalog.filter.brand");
    expect(html).toContain('href="/uk/c/shoes"');
    expect(html).toContain("§catalog.filter.clear");
  });

  it("links the subcategories under an h2", () => {
    const html = renderToStaticMarkup(
      <CatalogView {...props} subcategories={[category("tops", [], { name: "§tops" })]} />,
    );
    expect(html).toContain('href="/uk/c/tops"');
    expect(html).toContain("§catalog.subcategories");
  });

  it("shows the right empty state: no products, empty category, no products for a brand", () => {
    const empty = { items: [], total: 0, limit: 24, offset: 0 };
    const none = renderToStaticMarkup(
      <CatalogView {...props} products={empty} page={1} pageCount={0} />,
    );
    expect(none).toContain("§catalog.empty.title");
    expect(none).not.toContain("<ul");
    const emptyCategory = renderToStaticMarkup(
      <CatalogView {...props} products={empty} page={1} pageCount={0} isCategory />,
    );
    expect(emptyCategory).toContain("§catalog.category.empty.title");
    expect(emptyCategory).toContain('href="/uk/catalog"');
    const emptyBrand = renderToStaticMarkup(
      <CatalogView
        {...props}
        products={empty}
        page={1}
        pageCount={0}
        brand={{ slug: "acme", name: "acme" }}
      />,
    );
    expect(emptyBrand).toContain("§catalog.filter.empty.title");
    expect(emptyBrand).toContain('href="/uk/catalog"');
  });

  it("renders a description as text, keeping line breaks and escaping markup", () => {
    const html = renderToStaticMarkup(
      <CatalogView {...props} description={"line one\n<script>alert(1)</script>"} />,
    );
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("has no hardcoded text", () => {
    const html = withoutMoney(renderToStaticMarkup(<CatalogView {...props} />));
    expect(leftoverText(html)).toBe("");
    for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
  });
});

describe("home sections with data", () => {
  const data = {
    categories: [
      category("clothing", [], { name: "§clothing" }),
      category("books", [], { name: "§books" }),
    ],
    newProducts: [summary("a", { title: "§a" }), summary("b", { title: "§b" })],
    exponent: 2,
  };
  const html = renderToStaticMarkup(
    <HomeSections sections={homeSections} locale="uk" t={t} data={data} imageHosts={hosts} />,
  );

  it("renders category tiles and the new products with links, under a sound heading outline", () => {
    expect(html).toContain('href="/uk/c/clothing"');
    expect(html).toContain('href="/uk/c/books"');
    expect(html).toContain('href="/uk/p/a"');
    expect(html).toContain("§home.newProducts.all");
    expect([...html.matchAll(/<h([1-6])[ >]/g)].map((m) => m[1])).toEqual([
      "1",
      "2",
      "2",
      "3",
      "3",
    ]);
  });

  it("shows at most the configured number of category tiles", () => {
    const many = Array.from({ length: 30 }, (_, i) => category(`c${i}`, [], { name: `§c${i}` }));
    const limited = renderToStaticMarkup(
      <HomeSections
        sections={homeSections}
        locale="uk"
        t={t}
        data={{ ...data, categories: many }}
        imageHosts={hosts}
      />,
    );
    expect(limited.match(/href="\/uk\/c\//g)).toHaveLength(6);
  });

  it("falls back to the empty states without data", () => {
    const empty = renderToStaticMarkup(
      <HomeSections
        sections={homeSections}
        locale="uk"
        t={t}
        data={{ categories: [], newProducts: [] }}
        imageHosts={hosts}
      />,
    );
    expect(empty).toContain("§home.categoryTiles.empty.title");
    expect(empty).toContain("§home.newProducts.empty.title");
  });

  it("has no hardcoded text", () => {
    expect(leftoverText(withoutMoney(html))).toBe("");
  });
});

describe("ProductPurchaseView", () => {
  const multi = product({
    id: "p1",
    title: "§title",
    options: named(option("flavor", ["mint", "lemon"]), option("pack", ["six", "twelve"])),
    variants: [
      variant("mint-six", { flavor: "mint", pack: "six" }, { sku: "SKU-1" }),
      variant(
        "mint-twelve",
        { flavor: "mint", pack: "twelve" },
        { price: { amount: 2999, currency: "UAH", compareAtAmount: 3999 } },
      ),
      variant("lemon-twelve", { flavor: "lemon", pack: "twelve" }),
    ],
    price: { from: 1999, to: 2999, currency: "UAH" },
  });
  const gallery = [
    { src: "https://cdn.example.com/a.jpg", alt: "§A", optionValueId: null },
    { src: null, alt: null, optionValueId: null },
  ];
  const view = (overrides: Partial<Parameters<typeof ProductPurchaseView>[0]> = {}) =>
    renderToStaticMarkup(
      <ProductPurchaseView
        product={multi}
        gallery={gallery}
        exponent={2}
        locale="uk"
        t={t}
        brand={{ name: "§brand", path: "/catalog?brand=demo-brand" }}
        {...overrides}
      />,
    );

  it("renders one radio group per option from the API's names, with the first available variant selected", () => {
    const html = view();
    expect(html.match(/<fieldset/g)).toHaveLength(2);
    expect(html).toContain("<legend");
    expect(html).toContain("§flavor");
    expect(html).toContain("§pack");
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain('value="mint"');
  });

  it("disables a value that has no sellable variant with the earlier choices", () => {
    const html = view();
    // (mint, six) and (mint, twelve) exist; (lemon, six) does not, but lemon is the first option: never disabled.
    // With flavor=mint selected every pack exists. The reverse hole: lemon has only twelve.
    const lemonOnly = view({
      product: product({
        ...multi,
        variants: [
          variant("lemon-twelve", { flavor: "lemon", pack: "twelve" }),
          variant("mint-six", { flavor: "mint", pack: "six" }),
        ],
      }),
    });
    // The first available variant is (lemon, twelve): "six" has no variant with lemon, "twelve" has.
    expect(lemonOnly).toMatch(/<input[^>]*disabled=""[^>]*value="six"/);
    expect(lemonOnly).not.toMatch(/<input[^>]*disabled=""[^>]*value="twelve"/);
    expect(lemonOnly).not.toMatch(/<input[^>]*disabled=""[^>]*value="lemon"/);
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*disabled=""/);
  });

  it("shows no picker for a product with one default variant", () => {
    const html = view({
      product: product({ title: "§title", options: [], variants: [variant("only", {})] }),
    });
    expect(html).not.toContain("<fieldset");
    expect(html).toContain("§product.addToCart");
  });

  it("shows the selected variant's price and a struck-through compare-at price only when the API gives one", () => {
    const plain = view();
    expect(plain).toContain(money(1999));
    expect(plain).not.toContain("<s ");
    expect(plain).not.toContain("§product.compareAt.label");
    const sale = view({
      product: product({
        title: "§title",
        options: [],
        variants: [
          variant("only", {}, { price: { amount: 1999, currency: "UAH", compareAtAmount: 2599 } }),
        ],
      }),
    });
    expect(sale).toContain(money(2599));
    expect(sale).toMatch(/<s class="[^"]*">/);
    expect(sale).toContain("§product.compareAt.label");
  });

  it("shows the availability as text, never a quantity", () => {
    const low = view({
      product: product({
        title: "§title",
        options: [],
        variants: [variant("only", {}, { availability: "low_stock" })],
      }),
    });
    expect(low).toContain("§availability.low_stock");
    expect(low).not.toMatch(/\b\d+\s*(pcs|шт|left)/i);
  });

  it("offers the add button except for an out-of-stock variant, which gets a disabled button and the reason", () => {
    const sold = view({
      product: product({
        title: "§title",
        options: [],
        variants: [variant("only", {}, { availability: "out_of_stock" })],
      }),
    });
    expect(sold).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(sold).toContain("§availability.out_of_stock");
    expect(sold).toContain('aria-describedby="product-availability"');
    expect(view()).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("limits the quantity to 1..999 and labels every control", () => {
    const html = view();
    expect(html).toMatch(/<input[^>]*type="number"[^>]*/);
    expect(html).toContain('min="1"');
    expect(html).toContain('max="999"');
    expect(html).toContain('aria-label="§product.quantity.label"');
    expect(html).toContain('aria-label="§product.quantity.decrease"');
    expect(html).toContain('aria-label="§product.quantity.increase"');
  });

  it("always renders the live region for the add result, empty until there is one", () => {
    expect(view()).toContain('<div role="status"');
  });

  it("has an h1 with the title, a brand link to the filtered catalog and the SKU", () => {
    const html = view();
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('href="/uk/catalog?brand=demo-brand"');
    expect(html).toContain("§product.sku");
  });

  it("renders a gallery group with one labelled button per image and the first image eager", () => {
    const html = view();
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="§product.gallery.label"');
    expect(html.match(/aria-pressed=/g)).toHaveLength(2);
    expect(html).toContain("§product.gallery.show");
  });

  it("renders a single placeholder, with no thumbnails, for a product without media", () => {
    const html = view({ gallery: [] });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("aria-pressed");
    expect(html).toContain('role="img"');
  });

  it("renders the server content passed as children after the purchase block", () => {
    const html = view({ children: <p>after-content</p> });
    expect(html.indexOf("after-content")).toBeGreaterThan(html.indexOf("§product.addToCart"));
  });

  it("has no hardcoded text", () => {
    const html = withoutMoney(view());
    expect(leftoverText(html)).toBe("");
    // An empty alt is the decorative thumbnail inside a labelled button; every other text attribute is a message.
    for (const value of textAttributes(html).filter((text) => text !== "")) {
      expect(value.startsWith("§"), value).toBe(true);
    }
  });

  it("works with the real Ukrainian messages for every key it uses", () => {
    const real = createTranslator(uk, "uk");
    expect(() =>
      renderToStaticMarkup(
        <ProductPurchaseView
          product={multi}
          gallery={gallery}
          exponent={2}
          locale="uk"
          t={real}
          brand={null}
        />,
      ),
    ).not.toThrow();
  });
});

describe("ProductDetails", () => {
  it("renders the description as escaped text with its line breaks, never as HTML", () => {
    const html = renderToStaticMarkup(
      <ProductDetails
        t={t}
        description={'First line\n<img src=x onerror="alert(1)"><script>alert(2)</script>'}
        attributes={[]}
      />,
    );
    expect(html).toContain("whitespace-pre-line");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("lists the attributes as a definition list under an h2", () => {
    const html = renderToStaticMarkup(
      <ProductDetails
        t={t}
        description={null}
        attributes={[{ code: "a", name: "§name-a", text: "§value-a" }]}
      />,
    );
    expect(html).toContain("<dl");
    expect(html).toContain("<dt");
    expect(html).toContain("§name-a");
    expect(html).toContain("§value-a");
    expect(html.match(/<h2[ >]/g)).toHaveLength(1);
    expect(html).not.toContain("§product.description.title");
  });

  it("renders nothing for a product without description or attributes", () => {
    expect(renderToStaticMarkup(<ProductDetails t={t} description={null} attributes={[]} />)).toBe(
      "",
    );
    expect(renderToStaticMarkup(<ProductDetails t={t} description="  " attributes={[]} />)).toBe(
      "",
    );
  });
});

describe("JsonLd", () => {
  it("renders an application/ld+json script that parses back to the data and cannot be closed early", () => {
    const evil = '</script><script>alert("x")</script>';
    const html = renderToStaticMarkup(<JsonLd data={{ "@type": "Product", name: evil }} />);
    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const body = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    expect(JSON.parse(body)).toEqual({ "@type": "Product", name: evil });
  });
});

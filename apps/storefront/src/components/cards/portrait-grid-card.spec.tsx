import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductCardModel } from "../../lib/product-card-model";
import { leftoverText, sentinelTranslator } from "../test-helpers";
import { PortraitGridCard } from "./portrait-grid-card";

// FORK spec (reshape R1): the fork's own `grid` card, rendered directly (the registry is replaced by fixtures in upstream's
// fork runs, so this spec does not go through it).
const t = sentinelTranslator();

const model: ProductCardModel = {
  id: "p1",
  title: "§title",
  href: "/uk/p/demo",
  image: { src: null, alt: "§alt" },
  brand: { name: "§brand", href: "/uk/catalog?brand=demo" },
  price: "1 200 ₴",
  priceLabel: "§price-label",
  note: null,
  availability: { text: "§low", variant: "warning", badge: true },
};

function card(overrides: Partial<ProductCardModel> = {}): string {
  return renderToStaticMarkup(
    <PortraitGridCard
      card={{ ...model, ...overrides }}
      headingLevel="h3"
      eager={false}
      locale="uk"
      t={t}
    />,
  );
}

describe("PortraitGridCard (fork, reshape R1)", () => {
  it("keeps one link to the product (the title) and the brand link, under the given heading level", () => {
    const html = card();
    expect(html.match(/href="\/uk\/p\/demo"/g)).toHaveLength(1);
    expect(html).toMatch(/<h3[^>]*><a [^>]*href="\/uk\/p\/demo"[^>]*>§title<\/a><\/h3>/);
    expect(html).toContain('href="/uk/catalog?brand=demo"');
  });

  it("puts the picture in a portrait 4:5 rounded frame that zooms on hover, not for reduced motion", () => {
    const html = card();
    expect(html).toContain("aspect-4/5 overflow-hidden rounded-card");
    expect(html).toContain("group-hover:scale-105");
    expect(html).toContain("motion-reduce:group-hover:scale-100");
  });

  it("shows the price in a pill with its own surface and its spoken label, before the title", () => {
    const html = card();
    expect(html).toMatch(/absolute bottom-2 left-2 rounded-full bg-background[^"]*"[^>]*>/);
    expect(html.indexOf("§price-label")).toBeLessThan(html.indexOf("§title</a>"));
    expect(html).toContain("1 200 ₴");
  });

  it("shows availability as a badge only for an exception, else as hidden text", () => {
    expect(card()).toContain("absolute top-2 left-2");
    const inStock = card({ availability: { text: "§in", variant: "success", badge: false } });
    expect(inStock).not.toContain("absolute top-2 left-2");
    expect(inStock).toContain("§in");
  });

  it("names the favourite button with the product's title and keeps it a button, not a second product link", () => {
    const html = card();
    expect(html).toMatch(
      /<button type="button" aria-label="§custom\.card\.favourite" aria-pressed="false"/,
    );
  });

  it("shows the sale badge placeholder top right and no hardcoded text", () => {
    const html = card();
    expect(html).toMatch(/absolute top-2 right-2[^"]*"[^>]*>§custom\.card\.sale</);
    expect(leftoverText(html)).toBe("₴");
  });
});

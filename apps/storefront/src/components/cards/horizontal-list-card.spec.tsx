import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProductCardModel } from "../../lib/product-card-model";
import { leftoverText, sentinelTranslator } from "../test-helpers";
import { HorizontalListCard } from "./horizontal-list-card";

// FORK spec (reshape R2): the fork's own `list` card, rendered directly.
const t = sentinelTranslator();

const model: ProductCardModel = {
  id: "p1",
  title: "§title",
  href: "/uk/p/demo",
  image: { src: null, alt: "§alt" },
  brand: { name: "§brand", href: null },
  price: "1 200 ₴",
  priceLabel: "§price-label",
  note: "§note",
  availability: { text: "§out", variant: "danger", badge: true },
};

function card(overrides: Partial<ProductCardModel> = {}): string {
  return renderToStaticMarkup(
    <HorizontalListCard
      card={{ ...model, ...overrides }}
      headingLevel="h2"
      eager
      locale="uk"
      t={t}
    />,
  );
}

describe("HorizontalListCard (fork, reshape R2)", () => {
  it("is a row: the portrait picture first, then the text column", () => {
    const html = card();
    expect(html).toMatch(/^<article class="group relative flex gap-4 /);
    expect(html.indexOf("aspect-4/5")).toBeLessThan(html.indexOf("§title"));
  });

  it("keeps one link to the product under the given heading level, the brand as text without a brand path", () => {
    const html = card();
    expect(html.match(/href="/g)).toHaveLength(1);
    expect(html).toMatch(/<h2[^>]*><a [^>]*href="\/uk\/p\/demo"/);
    expect(html).toMatch(/<p class="[^"]*uppercase[^"]*">§brand<\/p>/);
  });

  it("shows the note, the price with its label, the availability and the favourite button at the row's end", () => {
    const html = card();
    for (const part of ["§note", "§price-label", "1 200 ₴", "§out"]) expect(html).toContain(part);
    expect(html).toMatch(/ms-auto"><button type="button" aria-label="§custom\.card\.favourite"/);
    const inStock = card({ availability: { text: "§in", variant: "success", badge: false } });
    expect(inStock).toContain("§in");
    expect(leftoverText(html)).toBe("₴");
  });
});

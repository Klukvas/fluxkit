import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { summary } from "../../lib/test-fixtures";
import { ProductGrid } from "../product-grid";
import { sentinelTranslator } from "../test-helpers";
import type { CardProps } from "./types";

// A fork's `custom.ts` registering a kind of its own and overriding `list`: the product grid must render through it.
vi.mock("./custom", () => {
  const Compact = ({ card, headingLevel: Heading }: CardProps) => (
    <article data-card="compact">
      <Heading>{card.title}</Heading>
    </article>
  );
  const entry = { Card: Compact, listClassName: "grid grid-cols-3 gap-2", maxEagerImages: 0 };
  return { customCards: { compact: entry, list: entry } };
});

const t = sentinelTranslator();

function grid(kind: string): string {
  return renderToStaticMarkup(
    <ProductGrid
      products={[summary("a", { title: "§a" })]}
      kind={kind}
      locale="uk"
      t={t}
      exponent={2}
      imageHosts={[]}
      headingLevel="h3"
      brandPathFor={(slug) => `/catalog?brand=${slug}`}
      label="§list"
    />,
  );
}

describe("cards/custom.ts (fork-owned registrations)", () => {
  it("renders a kind the fork registered, with its own list layout", () => {
    expect(grid("compact")).toBe(
      '<ul aria-label="§list" class="grid grid-cols-3 gap-2"><li><article data-card="compact"><h3>§a</h3></article></li></ul>',
    );
  });

  it("lets the fork override a built-in kind", () => {
    expect(grid("list")).toContain('data-card="compact"');
    expect(grid("grid")).not.toContain('data-card="compact"');
  });
});

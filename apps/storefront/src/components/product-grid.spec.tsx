import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductCardModel } from "../lib/product-card-model";
import { summary } from "../lib/test-fixtures";
import { messagesByLocale } from "../messages";
import { ProductGrid } from "./product-grid";
import { findElements } from "./test-helpers";

vi.mock("../config/slots", () => import("../test-support/template-defaults"));
vi.mock("./cards/custom", () => import("../test-support/template-defaults"));
vi.mock("./card-add-button", async (original) => {
  const module = await original<typeof import("./card-add-button")>();
  return {
    ...module,
    CardAddButton: ({ title, href }: { title: string; href: string }) => (
      <module.CardAddButtonView
        title={title}
        href={href}
        ready={false}
        status={{ state: "idle" }}
        t={createTranslator(messagesByLocale.en, "en")}
        onAdd={() => undefined}
      />
    ),
  };
});

const products = ["red", "blue"].map((valueCode) =>
  summary("shirt", {
    listingKey: `id-shirt:color:${valueCode}`,
    title: "Shirt",
    brand: null,
    listingOption: {
      optionCode: "color",
      valueCode,
      optionName: "Colour",
      valueName: valueCode === "red" ? "Red" : "Blue",
    },
    defaultVariantId: valueCode === "red" ? "red-m" : null,
  }),
);
const props = {
  products,
  locale: "en" as const,
  t: createTranslator(messagesByLocale.en, "en"),
  exponent: 2,
  imageHosts: [],
  headingLevel: "h2" as const,
  brandPathFor: () => "/catalog",
  label: "Products",
};

describe("listing rows", () => {
  it("uses distinct listing keys for repeated product ids", () => {
    const rows = findElements(ProductGrid(props), (element) => element.type === "li");
    expect(rows.map((row) => row.key)).toEqual(["id-shirt:color:red", "id-shirt:color:blue"]);
    const cards = rows.flatMap((row) =>
      findElements(row, (element) => Object.hasOwn(element.props, "card")),
    );
    expect(cards.map((element) => (element.props.card as ProductCardModel).id)).toEqual([
      "id-shirt",
      "id-shirt",
    ]);
  });

  for (const kind of ["grid", "list"] as const) {
    it(`names the ${kind} card and its purchase link with the suffix and preselection`, () => {
      const html = renderToStaticMarkup(<ProductGrid {...props} kind={kind} />);
      expect(html).toContain("Shirt — Red");
      expect(html).toContain("Shirt — Blue");
      expect(html.match(/href="\/en\/p\/shirt\?opt.color=red"/g)).toHaveLength(2);
      expect(html.match(/href="\/en\/p\/shirt\?opt.color=blue"/g)).toHaveLength(2);
      expect(html).toContain('class="sr-only">Shirt — Red</span>');
      expect(html).toContain('class="sr-only">Shirt — Blue</span>');
      expect(html).not.toContain("<button");
    });
  }
});

import { describe, expect, it } from "vitest";
import { sentinelTranslator } from "../components/test-helpers";
import { formatMoney } from "./money";
import { cardDisplay, listPriceLabel, type CardDisplayInput } from "./product-card-model";
import { summary } from "./test-fixtures";

const t = sentinelTranslator();
const money = (amount: number) => formatMoney({ amount, currency: "UAH" }, 2, "uk");

const base: Omit<CardDisplayInput, "product"> = {
  locale: "uk",
  t,
  exponent: 2,
  imageHosts: ["cdn.example.com"],
  brandPath: "/catalog?brand=demo-brand",
};

describe("listPriceLabel", () => {
  it("prints one price when the variants agree and 'from <lowest>' when they differ", () => {
    expect(listPriceLabel({ from: 1999, to: 1999, currency: "UAH" }, 2, "uk", t)).toBe(money(1999));
    expect(listPriceLabel({ from: 1999, to: 2999, currency: "UAH" }, 2, "uk", t)).toBe(
      "§catalog.price.from",
    );
  });
});

describe("cardDisplay (the plain view model every card kind renders)", () => {
  it("carries the product's own link, title, price, brand link and availability", () => {
    const card = cardDisplay({ ...base, product: summary("demo-shirt", { title: "§shirt" }) });
    expect(card).toEqual({
      id: "id-demo-shirt",
      title: "§shirt",
      href: "/uk/p/demo-shirt",
      image: { src: null, alt: "§shirt" },
      brand: { name: "§brand", href: "/uk/catalog?brand=demo-brand" },
      price: money(1999),
      priceLabel: "§product.price.label",
      note: null,
      availability: { text: "§availability.in_stock", variant: "success", badge: false },
    });
  });

  it("is plain data: no API object, no function, no React element", () => {
    const card = cardDisplay({ ...base, product: summary("p") });
    expect(JSON.parse(JSON.stringify(card))).toEqual(card);
  });

  it("encodes the slug, and keeps an allowed image with its alt (the title names an image without one)", () => {
    const card = cardDisplay({
      ...base,
      product: summary("a b/c", {
        title: "§x",
        image: { url: "https://cdn.example.com/a.jpg", alt: null },
      }),
    });
    expect(card.href).toBe("/uk/p/a%20b%2Fc");
    expect(card.image).toEqual({ src: "https://cdn.example.com/a.jpg", alt: "§x" });
  });

  it("drops an image of a host that is not allowed (the placeholder is shown)", () => {
    const card = cardDisplay({
      ...base,
      product: summary("b", { image: { url: "https://example.com/b.jpg", alt: "Alt" } }),
    });
    expect(card.image).toEqual({ src: null, alt: "Alt" });
  });

  it("shows the brand as text without a filter link, and no brand without one", () => {
    expect(cardDisplay({ ...base, brandPath: null, product: summary("s") }).brand).toEqual({
      name: "§brand",
      href: null,
    });
    expect(cardDisplay({ ...base, product: summary("s", { brand: null }) }).brand).toBeNull();
  });

  it("badges only an exception (low stock, out of stock); in stock stays text for assistive technology", () => {
    const of = (availability: "in_stock" | "low_stock" | "out_of_stock") =>
      cardDisplay({ ...base, product: summary("s", {}, availability) }).availability;
    expect(of("in_stock")).toEqual({
      text: "§availability.in_stock",
      variant: "success",
      badge: false,
    });
    expect(of("low_stock")).toEqual({
      text: "§availability.low_stock",
      variant: "warning",
      badge: true,
    });
    expect(of("out_of_stock")).toEqual({
      text: "§availability.out_of_stock",
      variant: "danger",
      badge: true,
    });
  });

  it("shows a search hit's matching variants: their price, availability, link and count note", () => {
    const card = cardDisplay({
      ...base,
      product: summary("lamp"),
      offer: {
        kind: "matched",
        price: { from: 2599, to: 2599, currency: "UAH" },
        availability: "low_stock",
        variantCount: 3,
        linkQuery: "opt.color=red",
      },
    });
    expect(card.href).toBe("/uk/p/lamp?opt.color=red");
    expect(card.price).toBe(money(2599));
    expect(card.availability?.text).toBe("§availability.low_stock");
    expect(card.note).toBe("§search.card.matchingOptions:3");
  });

  it("writes no count note for a single matching variant, and no link query when there is none", () => {
    const card = cardDisplay({
      ...base,
      product: summary("lamp"),
      offer: {
        kind: "matched",
        price: { from: 2599, to: 2599, currency: "UAH" },
        availability: "in_stock",
        variantCount: 1,
        linkQuery: "",
      },
    });
    expect(card.note).toBeNull();
    expect(card.href).toBe("/uk/p/lamp");
  });

  it("while the index catches up: the product's price, no availability, the neutral note", () => {
    const card = cardDisplay({
      ...base,
      product: summary("lamp", { price: { from: 1999, to: 2999, currency: "UAH" } }),
      offer: { kind: "catchingUp", linkQuery: "opt.size=l" },
    });
    expect(card.href).toBe("/uk/p/lamp?opt.size=l");
    expect(card.price).toBe("§catalog.price.from");
    expect(card.availability).toBeNull();
    expect(card.note).toBe("§search.card.dependsOnOption");
  });
});

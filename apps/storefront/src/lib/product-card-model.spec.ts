import { createTranslator } from "@fluxkit/ui";
import { cardOffer } from "./search-facets";
import { messagesByLocale } from "../messages";
import { describe, expect, it } from "vitest";
import { sentinelTranslator } from "../components/test-helpers";
import { formatMoney } from "./money";
import { cardDisplay, listPriceLabel, type CardDisplayInput } from "./product-card-model";
import { option, product, summary, variant } from "./test-fixtures";
import { findVariant, initialSelection, selectionFromParams } from "./variant-matcher";

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
      listingKey: "id-demo-shirt",
      title: "§shirt",
      href: "/uk/p/demo-shirt",
      image: { src: null, alt: "§shirt" },
      brand: { name: "§brand", href: "/uk/catalog?brand=demo-brand" },
      price: money(1999),
      priceLabel: "§product.price.label",
      note: null,
      availability: { text: "§availability.in_stock", variant: "success", badge: false },
      purchase: {
        kind: "choose",
        label: "§product.card.chooseOptions",
        shortLabel: "§product.card.chooseShort",
      },
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

describe("cardDisplay: what the card offers to buy (owner design 2026-11-13)", () => {
  const purchaseOf = (input: Partial<CardDisplayInput> & Pick<CardDisplayInput, "product">) =>
    cardDisplay({ ...base, ...input }).purchase;
  const oneVariant = (availability: "in_stock" | "low_stock" | "out_of_stock") =>
    summary("mug", { defaultVariantId: "variant-mug" }, availability);

  it("adds the only sellable variant from the card while it can be bought (in stock, low stock)", () => {
    expect(purchaseOf({ product: oneVariant("in_stock") })).toEqual({
      kind: "add",
      variantId: "variant-mug",
    });
    expect(purchaseOf({ product: oneVariant("low_stock") })).toEqual({
      kind: "add",
      variantId: "variant-mug",
    });
  });

  it("offers nothing for an out-of-stock product, with one variant or several", () => {
    expect(purchaseOf({ product: oneVariant("out_of_stock") })).toBeNull();
    expect(purchaseOf({ product: summary("shirt", {}, "out_of_stock") })).toBeNull();
  });

  it("links to the product page to choose when the product has several variants", () => {
    expect(purchaseOf({ product: summary("shirt", {}, "low_stock") })).toEqual({
      kind: "choose",
      label: "§product.card.chooseOptions",
      shortLabel: "§product.card.chooseShort",
    });
  });

  it("follows a search hit's shown availability, and offers nothing while the index catches up", () => {
    const matched = (availability: "in_stock" | "out_of_stock") =>
      ({
        kind: "matched",
        price: { from: 2599, to: 2599, currency: "UAH" },
        availability,
        variantCount: 1,
        linkQuery: "",
      }) as const;
    expect(purchaseOf({ product: oneVariant("in_stock"), offer: matched("in_stock") })).toEqual({
      kind: "add",
      variantId: "variant-mug",
    });
    expect(
      purchaseOf({ product: oneVariant("in_stock"), offer: matched("out_of_stock") }),
    ).toBeNull();
    expect(
      purchaseOf({
        product: oneVariant("in_stock"),
        offer: { kind: "catchingUp", linkQuery: "" },
      }),
    ).toBeNull();
  });
});

describe("split listing cards", () => {
  const split = summary("shirt", {
    listingKey: "id-shirt:color:red",
    listingOption: {
      optionCode: "color",
      valueCode: "red",
      optionName: "Colour",
      valueName: "Red",
    },
    image: { url: "https://cdn.example.com/red.jpg", alt: null },
  });

  for (const locale of ["uk", "en"] as const) {
    it(`uses the API group image and translated suffix in ${locale}, retaining product identity`, () => {
      const card = cardDisplay({
        ...base,
        locale,
        t: createTranslator(messagesByLocale[locale], locale),
        product: split,
      });
      expect(card.id).toBe(split.id);
      expect(card.listingKey).toBe(split.listingKey);
      expect(card.title).toBe(`${split.title} — Red`);
      expect(card.image).toEqual({ src: split.image?.url, alt: card.title });
      expect(card.href).toBe(`/${locale}/p/shirt?opt.color=red`);
    });
  }

  it("merges a match's other values, with the split authoritative, without authorizing multi-size add", () => {
    const item = {
      ...split,
      match: {
        variantId: "red-m",
        variantCount: 1,
        price: split.price,
        availability: "in_stock" as const,
        optionValues: [
          { optionCode: "color", valueCode: "black" },
          { optionCode: "size", valueCode: "m" },
        ],
      },
    };
    const card = cardDisplay({
      ...base,
      product: item,
      offer: cardOffer(item, { facets: [], price: null }),
    });
    expect(card.href).toBe("/uk/p/shirt?opt.color=red&opt.size=m");
    expect(card.purchase?.kind).toBe("choose");
  });

  it("keeps the split link while unavailable or catching up, and never picks another image", () => {
    const item = {
      ...split,
      image: null,
      defaultVariantId: "red-s",
      availability: "out_of_stock" as const,
    };
    expect(cardDisplay({ ...base, product: item }).purchase).toBeNull();
    const card = cardDisplay({
      ...base,
      product: item,
      offer: { kind: "catchingUp", linkQuery: "opt.color=black&opt.size=m" },
    });
    expect(card.href).toBe("/uk/p/shirt?opt.color=red");
    expect(card.purchase).toBeNull();
    expect(card.availability).toBeNull();
    expect(card.image.src).toBeNull();
    expect(
      cardDisplay({ ...base, product: { ...split, defaultVariantId: "red-s" } }).purchase,
    ).toEqual({ kind: "add", variantId: "red-s" });
  });

  it("opens the surviving split value with sparse variants and the split picker after size", () => {
    // Red/M disappeared after indexing; Black/M is the global default, but Red/S still exists.
    const detail = product({
      options: [option("size", ["m", "s"]), option("color", ["black", "red"])],
      variants: [
        variant("black-m", { size: "m", color: "black" }),
        variant("red-s", { size: "s", color: "red" }),
      ],
    });
    const item = { ...split, match: null };
    const offer = cardOffer(item, {
      facets: ["opt.size:m"],
      price: null,
    });
    expect(offer).toEqual({ kind: "catchingUp", linkQuery: "opt.size=m" });
    const card = cardDisplay({ ...base, product: item, offer });
    const params = new URL(card.href, "https://shop.example").searchParams;
    const selection = initialSelection(detail, selectionFromParams(Object.fromEntries(params)));
    expect(selection).toEqual({ size: "s", color: "red" });
    expect(findVariant(detail, selection)?.id).toBe("red-s");
    expect(card.href).toBe("/uk/p/shirt?opt.color=red");
    expect(card.purchase).toBeNull();
  });

  it("encodes arbitrary codes safely, including prototype member names", () => {
    const card = cardDisplay({
      ...base,
      product: {
        ...split,
        listingOption: {
          optionCode: "constructor",
          valueCode: "a&b",
          optionName: "X",
          valueName: "Y",
        },
      },
    });
    expect(card.href).toBe("/uk/p/shirt?opt.constructor=a%26b");
  });

  it("treats older summaries and explicit unsplit summaries as product cards", () => {
    const old = summary("old");
    expect(cardDisplay({ ...base, product: old })).toEqual(
      cardDisplay({ ...base, product: { ...old, listingKey: old.id, listingOption: null } }),
    );
  });
});

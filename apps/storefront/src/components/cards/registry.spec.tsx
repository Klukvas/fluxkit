import type { ProductSummary } from "@fluxkit/api-client";
import {
  Badge,
  PriceText,
  textStyles,
  VisuallyHidden,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availabilityDisplay } from "../../lib/availability";
import { allowedImageUrl } from "../../lib/image-source";
import { localizedHref } from "../../lib/locale-path";
import { formatMoney } from "../../lib/money";
import { cardDisplay, listPriceLabel, type ProductCardModel } from "../../lib/product-card-model";
import type { CardOffer } from "../../lib/search-facets";
import { summary } from "../../lib/test-fixtures";
import { ProductGrid } from "../product-grid";
import { StoreImage } from "../store-image";
import { focusRing } from "../styles";
import { leftoverText, sentinelTranslator } from "../test-helpers";
import { builtInCards, cardRegistry, createCardRegistry, resolveCard } from "./registry";
import type { CardKindEntry, CardProps } from "./types";

// Independent of the UI slots a fork fills in `config/slots.tsx` (plan S1): this spec checks the cards' own markup. Where the
// card slots render, and that empty slots add nothing, is `slot-places.spec.tsx`; filled slots, the fork run.
vi.mock("../../config/slots", () => ({ slots: {} }));
// FORK (a1-reshape): this spec pins the template's built-in cards; the fork overrides `grid` in `cards/custom.ts`.
vi.mock("./custom", () => ({ customCards: {} }));

const t = sentinelTranslator();
const hosts = ["cdn.example.com"];

/**
 * FROZEN copy of `components/product-card.tsx` as it was before the card registry (origin/main 094790c), test-only. The
 * registry's `grid` card must render exactly this markup for every input (plan 2026-11-08-design-changeability.md, L2: "no
 * change at defaults"). A deliberate change of the grid card updates this copy in the same PR, with its reason.
 */
const PRODUCT_OFFER: CardOffer = { kind: "product" };
function LegacyProductCard({
  product,
  locale,
  t,
  exponent,
  imageHosts,
  brandPath,
  headingLevel: Heading,
  eager = false,
  offer = PRODUCT_OFFER,
}: {
  product: ProductSummary;
  locale: Locale;
  t: Translator;
  exponent: number;
  imageHosts: readonly string[];
  brandPath: string | null;
  headingLevel: "h2" | "h3";
  eager?: boolean;
  offer?: CardOffer;
}) {
  const shown =
    offer.kind === "product"
      ? product.availability
      : offer.kind === "matched"
        ? offer.availability
        : null;
  const availability = shown === null ? null : availabilityDisplay(shown);
  const price = offer.kind === "matched" ? offer.price : product.price;
  const path = localizedHref(locale, `/p/${encodeURIComponent(product.slug)}`);
  const linkQuery = offer.kind === "product" ? "" : offer.linkQuery;
  const href = linkQuery === "" ? path : `${path}?${linkQuery}`;
  const note =
    offer.kind === "catchingUp"
      ? t("search.card.dependsOnOption")
      : offer.kind === "matched" && offer.variantCount > 1
        ? t.plural("search.card.matchingOptions", offer.variantCount)
        : null;
  const badgeShown = availability !== null && shown !== "in_stock";
  return (
    <article className="group relative flex h-full flex-col gap-2 rounded-card border border-border bg-background p-3 transition-shadow hover:border-border-input hover:shadow-raised focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring motion-reduce:transition-none">
      <StoreImage
        src={allowedImageUrl(product.image?.url, imageHosts)}
        alt={product.image?.alt ?? product.title}
        width={480}
        height={480}
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
        eager={eager}
      />
      {product.brand === null ? null : brandPath === null ? (
        <p className="text-sm text-muted-foreground">{product.brand.name}</p>
      ) : (
        <Link
          href={localizedHref(locale, brandPath)}
          className={`relative z-10 inline-flex min-h-6 w-fit items-center rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:pointer-events-none ${focusRing}`}
        >
          {product.brand.name}
        </Link>
      )}
      <Heading className={`${textStyles.cardTitle} line-clamp-2`} title={product.title}>
        <Link
          href={href}
          className="after:absolute after:inset-0 group-hover:underline group-hover:underline-offset-4 focus-visible:outline-none"
        >
          {product.title}
        </Link>
      </Heading>
      <div className="mt-auto flex flex-col gap-1 pt-1">
        {note === null ? null : <p className="text-sm text-muted-foreground">{note}</p>}
        <PriceText
          price={listPriceLabel(price, exponent, locale, t)}
          priceLabel={t("product.price.label")}
        />
        {availability !== null && !badgeShown ? (
          <VisuallyHidden>{t(availability.messageKey)}</VisuallyHidden>
        ) : null}
      </div>
      {availability !== null && badgeShown ? (
        <Badge
          variant={availability.variant}
          className="pointer-events-none absolute top-5 left-5 w-fit shadow-card"
        >
          {t(availability.messageKey)}
        </Badge>
      ) : null}
    </article>
  );
}

interface Case {
  name: string;
  product: ProductSummary;
  brandPath: string | null;
  offer?: CardOffer;
  eager?: boolean;
  headingLevel: "h2" | "h3";
  locale: Locale;
}

const matched = (variantCount: number, linkQuery: string): CardOffer => ({
  kind: "matched",
  price: { from: 2599, to: 3599, currency: "UAH" },
  availability: "out_of_stock",
  variantCount,
  linkQuery,
});

const CASES: Case[] = [
  {
    name: "in stock, brand link",
    product: summary("a", { title: "§a" }),
    brandPath: "/catalog?brand=demo-brand",
    headingLevel: "h2",
    locale: "uk",
  },
  {
    name: "low stock, plain brand, eager, h3, en",
    product: summary("b c", { title: "§b" }, "low_stock"),
    brandPath: null,
    eager: true,
    headingLevel: "h3",
    locale: "en",
  },
  {
    name: "out of stock, no brand, allowed image, price range",
    product: summary(
      "d",
      {
        title: "§d",
        brand: null,
        image: { url: "https://cdn.example.com/d.jpg", alt: "Alt" },
        price: { from: 1999, to: 2999, currency: "UAH" },
      },
      "out_of_stock",
    ),
    brandPath: null,
    headingLevel: "h2",
    locale: "uk",
  },
  {
    name: "image of a host that is not allowed, image without alt",
    product: summary("e", { title: "§e", image: { url: "https://example.com/e.jpg", alt: null } }),
    brandPath: "/c/lamps?brand=demo-brand",
    headingLevel: "h3",
    locale: "uk",
  },
  {
    name: "search hit with several matching variants",
    product: summary("f", { title: "§f" }),
    brandPath: "/search?f=brand%3Ademo-brand",
    offer: matched(3, "opt.color=red&opt.size=l"),
    headingLevel: "h3",
    locale: "uk",
  },
  {
    name: "search hit with one matching variant and no link query",
    product: summary("g", { title: "§g" }),
    brandPath: null,
    offer: matched(1, ""),
    headingLevel: "h3",
    locale: "en",
  },
  {
    name: "index catching up",
    product: summary("h", { title: "§h" }, "low_stock"),
    brandPath: "/catalog?brand=demo-brand",
    offer: { kind: "catchingUp", linkQuery: "opt.size=l" },
    headingLevel: "h3",
    locale: "uk",
  },
];

function legacy(entry: Case): string {
  return renderToStaticMarkup(
    <LegacyProductCard
      product={entry.product}
      locale={entry.locale}
      t={t}
      exponent={2}
      imageHosts={hosts}
      brandPath={entry.brandPath}
      headingLevel={entry.headingLevel}
      eager={entry.eager}
      offer={entry.offer}
    />,
  );
}

function model(entry: Case): ProductCardModel {
  return cardDisplay({
    product: entry.product,
    locale: entry.locale,
    t,
    exponent: 2,
    imageHosts: hosts,
    brandPath: entry.brandPath,
    ...(entry.offer === undefined ? {} : { offer: entry.offer }),
  });
}

function render(kind: string, entry: Case): string {
  const { Card } = resolveCard(kind);
  return renderToStaticMarkup(
    <Card
      card={model(entry)}
      headingLevel={entry.headingLevel}
      eager={entry.eager ?? false}
      locale={entry.locale}
      t={t}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("card registry: the default grid card", () => {
  it.each(CASES)("renders exactly today's product card markup ($name)", (entry) => {
    expect(render("grid", entry)).toBe(legacy(entry));
  });

  it("lays the grid out in today's columns and loads the first row eagerly", () => {
    const products = Array.from({ length: 6 }, (_, i) => summary(`p${i}`, { title: `§p${i}` }));
    const html = renderToStaticMarkup(
      <ProductGrid
        products={products}
        locale="uk"
        t={t}
        exponent={2}
        imageHosts={hosts}
        headingLevel="h2"
        brandPathFor={(slug) => `/catalog?brand=${slug}`}
        label="§list"
      />,
    );
    const items = products.map((product) =>
      legacy({
        name: product.slug,
        product,
        brandPath: "/catalog?brand=demo-brand",
        headingLevel: "h2",
        locale: "uk",
      }),
    );
    expect(html).toBe(
      `<ul aria-label="§list" class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">${items
        .map((item) => `<li>${item}</li>`)
        .join("")}</ul>`,
    );
  });
});

describe("card registry: kinds", () => {
  it("ships the grid and list kinds", () => {
    expect(Object.keys(builtInCards).sort()).toEqual(["grid", "list"]);
    expect(Object.keys(cardRegistry)).toEqual(expect.arrayContaining(["grid", "list"]));
  });

  it("uses a kind a fork registers, and lets a fork override a built-in kind", () => {
    const Compact = ({ card }: CardProps) => <p data-compact>{card.title}</p>;
    const compact: CardKindEntry = { Card: Compact, listClassName: "grid", maxEagerImages: 1 };
    const registry = createCardRegistry({ compact, grid: compact });
    expect(resolveCard("compact", registry)).toBe(compact);
    expect(resolveCard("grid", registry)).toBe(compact);
    expect(resolveCard("list", registry)).toBe(builtInCards.list);
  });

  it("falls back to the grid card for an unknown kind, and says so loudly (never silently)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(resolveCard("carousel")).toBe(cardRegistry.grid);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/Unknown product card kind "carousel"/);
  });
});

describe("the list card", () => {
  const entry = CASES[0] as Case;

  it("shows one link to the product, the brand link, the price and the availability, with translated text only", () => {
    const html = render("list", entry);
    expect(html.match(/<article[ >]/g)).toHaveLength(1);
    expect(html.match(/<h2[ >]/g)).toHaveLength(1);
    expect(html).toContain('href="/uk/p/a"');
    expect(html).toContain('href="/uk/catalog?brand=demo-brand"');
    expect(html).toContain("§product.price.label");
    expect(html).toContain("§availability.in_stock");
    // The image is named by the title (no image alt): the placeholder carries it.
    expect(html).toContain('aria-label="§a"');
    expect(
      leftoverText(html.replace(formatMoney({ amount: 1999, currency: "UAH" }, 2, "uk"), "")),
    ).toBe("");
  });

  it("badges an exception (low stock) and writes a search hit's note and link", () => {
    const lowStock = render("list", CASES[1] as Case);
    expect(lowStock).toMatch(/<span class="[^"]*">§availability\.low_stock<\/span>/);
    expect(lowStock).not.toContain('<span class="sr-only">§availability.low_stock');
    const catchingUp = render("list", CASES[6] as Case);
    expect(catchingUp).toContain("§search.card.dependsOnOption");
    expect(catchingUp).toContain('href="/uk/p/h?opt.size=l"');
    expect(catchingUp).not.toContain("§availability");
  });

  it("is laid out one card per row, with at most two eager images", () => {
    const products = Array.from({ length: 4 }, (_, i) =>
      summary(`p${i}`, {
        title: `§p${i}`,
        image: { url: `https://cdn.example.com/p${i}.jpg`, alt: null },
      }),
    );
    const html = renderToStaticMarkup(
      <ProductGrid
        products={products}
        kind="list"
        locale="uk"
        t={t}
        exponent={2}
        imageHosts={["cdn.example.com"]}
        headingLevel="h2"
        brandPathFor={(slug) => `/catalog?brand=${slug}`}
        label="§list"
      />,
    );
    expect(html).toContain('<ul aria-label="§list" class="grid grid-cols-1 gap-4">');
    expect(html.match(/<li[ >]/g)).toHaveLength(4);
    expect(html.match(/loading="eager"/g)).toHaveLength(2);
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
  });
});

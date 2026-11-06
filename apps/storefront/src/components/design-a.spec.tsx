import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { trustBarItems } from "../config/trust-bar";
import { summary } from "../lib/test-fixtures";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { AccountBreadcrumbsView } from "./account-nav";
import { CheckoutSteps } from "./checkout-steps";
import { ProductCard } from "./product-card";
import { sentinelTranslator } from "./test-helpers";
import { StoreTrustBar } from "./trust-bar";

// Design batch A (plan 2026-11-03-storefront-design-a.md): the trust bar, the funnel steps, the account breadcrumbs and the
// product card's badges and alignment.
const t = sentinelTranslator();

describe("StoreTrustBar (config/trust-bar.ts)", () => {
  it("shows the configured items with decorative icons, in the config's order", () => {
    const html = renderToStaticMarkup(<StoreTrustBar t={t} locale="en" />);
    expect(html).toContain('aria-label="§trust.label"');
    expect(html.match(/<li/g)).toHaveLength(trustBarItems.length);
    // A line with a `page` is a link to that shop page (repair batch 2), the others plain text.
    const texts = [...html.matchAll(/>(§trust\.[a-z]+)<\/(?:span|a)>/g)].map((match) => match[1]);
    expect(texts).toEqual(trustBarItems.map((item) => `§${item.messageKey}`));
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders nothing when the config lists no item (a shop without promises to show)", () => {
    expect(renderToStaticMarkup(<StoreTrustBar t={t} locale="en" items={[]} />)).toBe("");
  });

  it("has a text in both locales for every default item, marked as demo copy in the config", () => {
    for (const item of trustBarItems) {
      expect(uk[item.messageKey as keyof typeof uk], item.messageKey).toBeTruthy();
      expect(en[item.messageKey as keyof typeof en], item.messageKey).toBeTruthy();
    }
  });
});

describe("CheckoutSteps (the funnel)", () => {
  const steps = (current: "cart" | "checkout" | "order") =>
    renderToStaticMarkup(
      <CheckoutSteps t={createTranslator(en, "en")} locale="en" current={current} />,
    );

  it("marks the current step with aria-current=step, one per page", () => {
    for (const [current, label] of [
      ["cart", "Cart"],
      ["checkout", "Checkout"],
      ["order", "Order"],
    ] as const) {
      const html = steps(current);
      expect(html.match(/aria-current="step"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`<li[^>]*aria-current="step"[^>]*>.*?${label}<`));
    }
  });

  it("links the cart from the checkout only, and says 'Step 2 of 3' for the compact view", () => {
    expect(steps("checkout")).toContain('href="/en/cart"');
    expect(steps("cart")).not.toContain("href=");
    expect(steps("order")).not.toContain("href=");
    expect(steps("checkout")).toContain("Step 2 of 3: Checkout");
    expect(steps("order")).toContain("Step 3 of 3: Order");
  });
});

describe("AccountBreadcrumbsView", () => {
  const crumbs = (pathname: string) =>
    renderToStaticMarkup(
      <AccountBreadcrumbsView t={createTranslator(uk, "uk")} locale="uk" pathname={pathname} />,
    );

  it("leads from home to the account section and the order number", () => {
    const html = crumbs("/account/orders/GCAD-8X10");
    expect(html).toContain('href="/uk"');
    expect(html).toContain('href="/uk/account"');
    expect(html).toContain('href="/uk/account/orders"');
    expect(html).toMatch(/aria-current="page"[^>]*>GCAD-8X10</);
  });

  it("uses the one uk word for the account (review D-11)", () => {
    expect(crumbs("/account/profile")).toContain(uk["nav.account.overview"]);
    expect(uk["nav.account.overview"]).toContain("акаунт");
  });

  it("renders nothing outside the account sections", () => {
    expect(crumbs("/cart")).toBe("");
  });
});

describe("ProductCard (review D-07, D-15)", () => {
  const card = (availability: "in_stock" | "low_stock" | "out_of_stock") =>
    renderToStaticMarkup(
      <ProductCard
        product={summary("lamp", { title: "§lamp", availability })}
        locale="uk"
        t={t}
        exponent={2}
        imageHosts={[]}
        brandPath="/catalog?brand=demo-brand"
        headingLevel="h2"
      />,
    );

  // Review m5 of PR 217: a title cut at two lines can still be read in full by a mouse user (a tooltip on the heading, not on
  // the link, so the link's accessible name and description stay the title once).
  it("gives the clamped title heading the full title as a tooltip, not the link", () => {
    const html = card("in_stock");
    expect(html).toMatch(/<h2 class="[^"]*line-clamp-2[^"]*" title="§lamp">/);
    expect(html).not.toMatch(/<a [^>]*title=/);
  });

  it("shows no stock badge for in stock, but keeps the words for assistive technology", () => {
    const html = card("in_stock");
    expect(html).toContain('<span class="sr-only">§availability.in_stock</span>');
    expect(html).not.toMatch(/absolute[^"]*">§availability/);
  });

  it("shows a badge over the image corner only for low stock and out of stock", () => {
    expect(card("low_stock")).toMatch(/absolute[^"]*">§availability\.low_stock</);
    expect(card("out_of_stock")).toMatch(/absolute[^"]*">§availability\.out_of_stock</);
  });

  it("has a hover elevation, a clamped title, the brand as a meta line and the price at the bottom", () => {
    const html = card("in_stock");
    const article = /<article class="([^"]*)"/.exec(html)?.[1]?.split(" ") ?? [];
    for (const name of ["hover:shadow-raised", "hover:border-border-input", "h-full"]) {
      expect(article).toContain(name);
    }
    expect(html).toMatch(/<h2 class="[^"]*line-clamp-2/);
    // The brand comes before the title and is not underlined until hover.
    expect(html.indexOf("brand=demo-brand")).toBeLessThan(html.indexOf("<h2"));
    const brand = (/<a [^>]*class="([^"]*)"[^>]*>§brand/.exec(html)?.[1] ?? "").split(" ");
    expect(brand).toContain("hover:underline");
    expect(brand).not.toContain("underline");
    expect(html).toMatch(/<div class="mt-auto[^"]*">/);
  });
});

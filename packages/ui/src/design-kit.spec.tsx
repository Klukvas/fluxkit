import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Disclosure } from "./disclosure";
import { Hero } from "./hero";
import { OptionPicker } from "./option-picker";
import { PriceText } from "./price-text";
import { StepIndicator } from "./step-indicator";
import { textStyles } from "./styles";
import { TrustBar } from "./trust-bar";
import { first, render, tags, text } from "./test-helpers";

// The design kit of review D-19 and recommendations 1, 3, 5 (plan 2026-11-03-storefront-design-a.md).

describe("Button sizes and hover", () => {
  it("keeps the default size of before and adds a 48 px large size", () => {
    expect(String(first(render(<Button>Go</Button>), "button").attributes.class)).toContain(
      "px-4 py-2",
    );
    const large = String(first(render(<Button size="lg">Go</Button>), "button").attributes.class);
    expect(large).toContain("min-h-12");
    expect(large).toContain("text-lg");
  });

  it("changes on hover only while enabled, and never animates its colours", () => {
    const classes = String(first(render(<Button>Go</Button>), "button").attributes.class);
    expect(classes).toContain("enabled:hover:bg-primary/90");
    // A colour transition also animates the outline colour: the focus ring would fade in from the text colour (found by the
    // e2e focus check), so the kit has none on controls.
    expect(classes).not.toMatch(/\btransition/);
  });
});

describe("PriceText discount", () => {
  it("shows the badge text to the eye and the spoken label to assistive technology", () => {
    const markup = render(
      <PriceText
        price="599,00 ₴"
        priceLabel="Ціна"
        compareAt="799,00 ₴"
        compareAtLabel="Стара ціна"
        discount={{ text: "−25 %", label: "Знижка 25 %" }}
      />,
    );
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*bg-danger[^>]*>−25 %<\/span>/);
    expect(markup).toMatch(/<span class="sr-only">Знижка 25 %<\/span>/);
    expect(text(markup)).toBe("Ціна 599,00 ₴ Стара ціна 799,00 ₴ −25 % Знижка 25 %");
  });

  it("shows no badge without a discount", () => {
    const markup = render(<PriceText price="1 ₴" compareAt="2 ₴" compareAtLabel="Was" />);
    expect(markup).not.toContain("bg-danger");
  });
});

describe("OptionPicker sold-out values", () => {
  const markup = render(
    <OptionPicker
      name="size"
      legend="Size"
      values={[
        { value: "s", label: "S" },
        { value: "l", label: "L", soldOut: true },
        { value: "xl", label: "XL", disabled: true },
      ]}
      selected="s"
      onChange={() => undefined}
      soldOutLabel="out of stock"
    />,
  );

  it("keeps a sold-out value selectable, struck through, with the spoken word", () => {
    const radios = tags(markup, "input");
    expect(radios.map((radio) => radio.attributes.disabled ?? false)).toEqual([false, false, true]);
    // The name stays "L"; "out of stock" is the radio's description (a hidden element outside the label).
    expect(markup).toMatch(
      /line-through[^"]*">L<\/span><\/label><span id="size-l-sold-out" hidden="">out of stock<\/span>/,
    );
    expect(radios[1]?.attributes["aria-describedby"]).toBe("size-l-sold-out");
    expect(radios[0]?.attributes["aria-describedby"]).toBeUndefined();
  });

  it("does not call an unavailable value sold out", () => {
    expect(markup.match(/out of stock/g)).toHaveLength(1);
  });
});

describe("TrustBar", () => {
  it("is a labelled list of decorative icons and texts", () => {
    const markup = render(
      <TrustBar
        label="Why shop here"
        items={[
          { key: "a", icon: <svg />, text: "Delivery" },
          { key: "b", icon: <svg />, text: "Secure payment" },
        ]}
      />,
    );
    expect(first(markup, "ul").attributes["aria-label"]).toBe("Why shop here");
    expect(tags(markup, "li")).toHaveLength(2);
    expect(
      tags(markup, "span").filter((tag) => tag.attributes["aria-hidden"] === "true"),
    ).toHaveLength(2);
    expect(text(markup)).toBe("Delivery Secure payment");
  });

  it("renders nothing without items (an empty config hides it)", () => {
    expect(render(<TrustBar label="Why shop here" items={[]} />)).toBe("");
  });
});

describe("StepIndicator", () => {
  const markup = render(
    <StepIndicator
      label="Checkout progress"
      steps={[{ label: "Cart", href: "/uk/cart" }, { label: "Checkout" }, { label: "Order" }]}
      current={1}
      completedLabel="completed"
      compactText="Step 2 of 3: Checkout"
    />,
  );

  it("marks exactly the current step with aria-current=step inside a labelled nav", () => {
    expect(first(markup, "nav").attributes["aria-label"]).toBe("Checkout progress");
    const steps = tags(markup, "li");
    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.attributes["aria-current"] ?? null)).toEqual([
      null,
      "step",
      null,
    ]);
  });

  it("links a completed step back and says it is completed", () => {
    expect(tags(markup, "a").map((link) => link.attributes.href)).toEqual(["/uk/cart"]);
    expect(markup).toContain('<span class="sr-only"> completed</span>');
  });

  // Review m2 of PR 217: below `md` the list is visually hidden, so its link must not be a focus stop there.
  it("hides the link below md and shows the same step as plain text instead", () => {
    expect(String(first(markup, "a").attributes.class).split(" ")).toContain("max-md:hidden");
    expect(markup).toMatch(/<\/a><span class="inline-flex items-center gap-2 md:hidden">/);
  });

  it("shows the compact line below md only, hidden from assistive technology", () => {
    const compact = first(markup, "p");
    expect(compact.attributes["aria-hidden"]).toBe("true");
    expect(String(compact.attributes.class)).toContain("md:hidden");
    expect(String(first(markup, "ol").attributes.class)).toContain("max-md:sr-only");
  });
});

describe("Disclosure", () => {
  it("is an open details element with a real heading in its summary", () => {
    const markup = render(
      <Disclosure title="Description" headingId="product-description-title">
        <p>Body</p>
      </Disclosure>,
    );
    expect(first(markup, "details").attributes).toHaveProperty("open");
    expect(markup).toMatch(
      /<summary[^>]*><h2 id="product-description-title"[^>]*>Description<\/h2>/,
    );
    expect(first(markup, "div").attributes["aria-labelledby"]).toBe("product-description-title");
  });
});

describe("textStyles", () => {
  it("uses only scale sizes and colour tokens", () => {
    expect(textStyles.pageTitle).toBe("text-3xl font-bold text-foreground");
    expect(textStyles.sectionTitle).toBe("text-xl font-semibold text-foreground");
  });
});

describe("Hero (design batch B)", () => {
  it("is a section labelled by its heading, at the level the page asks for", () => {
    const markup = render(<Hero headingId="hero-a" headingLevel="h1" title="Welcome" />);
    expect(first(markup, "section").attributes["aria-labelledby"]).toBe("hero-a");
    expect(first(markup, "h1").attributes.id).toBe("hero-a");
    expect(tags(markup, "h2")).toHaveLength(0);
    const second = render(<Hero headingId="hero-b" headingLevel="h2" title="Sale" />);
    expect(first(second, "h2").attributes.id).toBe("hero-b");
    expect(tags(second, "h1")).toHaveLength(0);
  });

  it("renders the subline, the action and the picture only when given, text before the picture", () => {
    const bare = render(<Hero headingId="h" headingLevel="h2" title="T" />);
    expect(tags(bare, "p")).toHaveLength(0);
    expect(String(first(bare, "section").attributes.class)).not.toContain("md:grid-cols-2");
    const full = render(
      <Hero
        headingId="h"
        headingLevel="h2"
        title="T"
        subline="S"
        action={<a href="/c">Go</a>}
        media={<img src="/x.svg" alt="" width={4} height={3} />}
      />,
    );
    expect(text(full)).toBe("T S Go");
    expect(String(first(full, "section").attributes.class)).toContain("md:grid-cols-2");
    expect(full.indexOf("<h2")).toBeLessThan(full.indexOf("<img"));
  });

  it("sits on the muted token surface (text pairs foreground and muted-foreground on muted are contrast-tested)", () => {
    const classes = String(
      first(render(<Hero headingId="h" headingLevel="h2" title="T" />), "section").attributes.class,
    );
    expect(classes).toContain("bg-muted");
    expect(classes).toContain("rounded-lg");
  });
});

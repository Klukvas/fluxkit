import { Button } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Failure } from "../lib/failure";
import { cartOf } from "../lib/test-fixtures";
import {
  addOnce,
  CardAddButtonView,
  statusAfterAdd,
  type CardAddButtonViewProps,
  type CardAddStatus,
} from "./card-add-button";
import { findElements, leftoverText, sentinelTranslator } from "./test-helpers";

const t = sentinelTranslator();

function view(status: CardAddStatus, overrides: Partial<CardAddButtonViewProps> = {}) {
  const props: CardAddButtonViewProps = {
    title: "§mug",
    href: "/uk/p/mug",
    status,
    ready: true,
    t,
    onAdd: () => undefined,
    ...overrides,
  };
  return { props, html: renderToStaticMarkup(<CardAddButtonView {...props} />) };
}

const failure = (messageKey: string): Failure => ({
  messageKey,
  status: 409,
  code: "rule_violation",
  retryAfterSeconds: null,
  fieldErrors: [],
});

describe("the card's add-to-cart button", () => {
  it("is a real button above the card's link layer, named with the label and the product title, 44 px high", () => {
    const { html } = view({ state: "idle" });
    expect(html).toMatch(/^<div class="relative z-10 /);
    expect(html).toMatch(
      /<button type="button" class="[^"]*min-h-11[^"]*" aria-disabled="false" aria-busy="false"><span>§product\.addToCart<\/span> <span class="sr-only">§mug<\/span><\/button>/,
    );
    // The status region is there from the start (empty), so a later change is announced.
    expect(html).toContain('<p role="status" class="text-sm"></p>');
    expect(leftoverText(html)).toBe("");
  });

  it("before hydration (and without a script) is a working link to the product page instead: one control, same words and size", () => {
    const { html } = view({ state: "idle" }, { ready: false });
    expect(html).not.toContain("<button");
    expect(html).toMatch(
      /^<div class="relative z-10 flex flex-col"><a class="[^"]*min-h-11[^"]*" href="\/uk\/p\/mug"><span>§product\.addToCart<\/span> <span class="sr-only">§mug<\/span><\/a><p role="status" class="text-sm"><\/p><\/div>$/,
    );
  });

  it("while adding: says so and stays focusable (aria-disabled, aria-busy, never disabled)", () => {
    const { html } = view({ state: "pending" });
    expect(html).toContain('aria-disabled="true" aria-busy="true"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("§product.card.adding");
  });

  it("adds on a click when idle", () => {
    const onAdd = vi.fn();
    const { props } = view({ state: "idle" }, { onAdd });
    const [button] = findElements(CardAddButtonView(props), (element) => element.type === Button);
    (button?.props.onClick as () => void)();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("confirms an add in the button and announces it in the status region", () => {
    const { html } = view({ state: "added" });
    expect(html).toContain("<span>§product.card.added</span>");
    expect(html).toContain(
      '<p role="status" class="text-sm"><span class="sr-only">§product.added</span></p>',
    );
  });

  it("shows a failure in words in the status region, and lets the shopper try again", () => {
    const { html } = view({ state: "failed", messageKey: "errors.rule.variant_not_sellable" });
    expect(html).toContain(
      '<p role="status" class="text-sm"><span class="mt-1 block text-danger">§errors.rule.variant_not_sellable</span></p>',
    );
    expect(html).toContain("<span>§product.addToCart</span>");
    expect(html).toContain('aria-disabled="false"');
  });
});

describe("addOnce (the island's in-flight guard)", () => {
  it("sends one add for two rapid clicks, and adds again once the first is answered", async () => {
    let answer: () => void = () => undefined;
    const add = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    const inFlight = { current: false };
    const first = addOnce(inFlight, add);
    const second = addOnce(inFlight, add);
    expect(add).toHaveBeenCalledTimes(1);
    answer();
    await Promise.all([first, second]);
    expect(inFlight.current).toBe(false);
    const third = addOnce(inFlight, add);
    expect(add).toHaveBeenCalledTimes(2);
    answer();
    await third;
  });

  it("frees the guard when the add throws, and lets the error through", async () => {
    const inFlight = { current: false };
    await expect(addOnce(inFlight, () => Promise.reject(new Error("bug")))).rejects.toThrow("bug");
    expect(inFlight.current).toBe(false);
  });
});

describe("statusAfterAdd", () => {
  it("is added when the cart store took the line, else the store's own failure words", () => {
    expect(statusAfterAdd({ status: "ok", cart: cartOf([]) })).toEqual({ state: "added" });
    expect(
      statusAfterAdd({ status: "failed", failure: failure("errors.rule.quantity_limit") }),
    ).toEqual({ state: "failed", messageKey: "errors.rule.quantity_limit" });
  });
});

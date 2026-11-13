import { Button } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Failure } from "../lib/failure";
import { cartOf } from "../lib/test-fixtures";
import {
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

  it("is disabled before hydration, when a tap could not reach the cart yet", () => {
    const { html } = view({ state: "idle" }, { ready: false });
    expect(html).toContain('disabled=""');
    expect(html).toContain('data-ready="false"');
  });

  it("while adding: says so, stays focusable (aria-disabled, aria-busy) and ignores a repeat", () => {
    const onAdd = vi.fn();
    const { html, props } = view({ state: "pending" }, { onAdd });
    expect(html).toContain('aria-disabled="true" aria-busy="true"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain("§product.card.adding");
    const [button] = findElements(CardAddButtonView(props), (element) => element.type === Button);
    (button?.props.onClick as () => void)();
    expect(onAdd).not.toHaveBeenCalled();
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

describe("statusAfterAdd", () => {
  it("is added when the cart store took the line, else the store's own failure words", () => {
    expect(statusAfterAdd({ status: "ok", cart: cartOf([]) })).toEqual({ state: "added" });
    expect(
      statusAfterAdd({ status: "failed", failure: failure("errors.rule.quantity_limit") }),
    ).toEqual({ state: "failed", messageKey: "errors.rule.quantity_limit" });
  });
});

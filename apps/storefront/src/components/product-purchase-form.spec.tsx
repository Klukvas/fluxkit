import { ActionButton } from "@fluxkit/ui";
import type { ComponentProps, FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { product } from "../lib/test-fixtures";
import { ProductPurchaseForm } from "./product-purchase-form";
import { findElements, sentinelTranslator } from "./test-helpers";

function props(): ComponentProps<typeof ProductPurchaseForm> {
  return {
    product: product(),
    t: sentinelTranslator(),
    locale: "en",
    chosen: "",
    selection: {},
    optionGuide: null,
    otherOnSale: false,
    shownQuantity: 1,
    room: 0,
    pending: false,
    atLimit: true,
    purchasable: false,
    ready: true,
    soldOut: false,
    inCart: 99,
    stock: null,
    status: { state: "added" },
    formRef: null,
    addButtonRef: null,
    onSubmit: vi.fn(),
    onSelection: vi.fn(),
    onQuantity: vi.fn(),
  };
}

describe("exhausted product add control", () => {
  it("stays focusable for drawer focus return and blocks form submission including Enter", () => {
    const input = props();
    const tree = ProductPurchaseForm(input);
    const [button] = findElements(tree, (element) => element.type === ActionButton);
    expect(button?.props.disabled).toBeFalsy();
    expect(button?.props["aria-disabled"]).toBe(true);
    const preventDefault = vi.fn();
    tree.props.onSubmit({ preventDefault } as unknown as FormEvent<HTMLFormElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(input.onSubmit).not.toHaveBeenCalled();
  });
  it("keeps the pre-hydration submit natively disabled so it cannot post without its guard", () => {
    const tree = ProductPurchaseForm({ ...props(), ready: false });
    const [button] = findElements(tree, (element) => element.type === ActionButton);
    expect(button?.props.disabled).toBe(true);
  });
  it("allows a ready, purchasable form to submit", () => {
    const input = { ...props(), purchasable: true, atLimit: false, room: 5 };
    const event = { preventDefault: vi.fn() };
    ProductPurchaseForm(input).props.onSubmit(event as unknown as FormEvent<HTMLFormElement>);
    expect(input.onSubmit).toHaveBeenCalledWith(event);
  });
});

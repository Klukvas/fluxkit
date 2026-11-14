import { Button, createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { initialCartState, type CartState } from "../lib/cart-store";
import { cartLine, cartOf } from "../lib/test-fixtures";
import { messagesByLocale } from "../messages";
import { CartDrawerView, type CartDrawerViewProps } from "./cart-drawer-view";
import { findElements } from "./test-helpers";

const t = createTranslator(messagesByLocale.en, "en");
function props(state: CartState): CartDrawerViewProps {
  return {
    state,
    open: true,
    onClose: vi.fn(),
    t,
    locale: "en",
    exponent: 2,
    imageHosts: [],
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    onAcknowledge: vi.fn(),
    onSetQuantity: vi.fn(),
    registerLine: vi.fn(),
    onViewCart: vi.fn(),
    onCheckout: vi.fn(),
  };
}
const ready = (cart = cartOf([])): CartState => ({ ...initialCartState, status: "ready", cart });

describe("CartDrawerView", () => {
  it("keeps a status region and labels the modal during loading", () => {
    const html = renderToStaticMarkup(<CartDrawerView {...props(initialCartState)} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading the cart");
    expect(html).toContain("Close the cart");
  });
  it("offers retry on a first-read error", () => {
    const input = props({
      ...initialCartState,
      status: "error",
      failure: {
        messageKey: "errors.network",
        status: null,
        code: null,
        retryAfterSeconds: null,
        fieldErrors: [],
      },
    });
    const tree = CartDrawerView(input);
    const retry = findElements(
      tree,
      (element) => element.type === Button && element.props.onClick === input.onRetry,
    );
    expect(retry).toHaveLength(1);
    (retry[0]?.props.onClick as () => void)();
    expect(input.onRetry).toHaveBeenCalledOnce();
  });
  it("offers the catalog and a decorative illustration when empty", () => {
    const html = renderToStaticMarkup(<CartDrawerView {...props(ready())} />);
    expect(html).toContain("Your cart is empty");
    expect(html).toContain('href="/en/catalog"');
    expect(html).toContain('<svg aria-hidden="true"');
    expect(html).not.toContain('href="/en/checkout"');
  });
  it("renders server totals without deriving them from draft quantities or prices", () => {
    const cart = {
      ...cartOf([
        cartLine("drawer", {
          quantity: 3,
          title: "Screwdriver",
          unitPrice: { amount: 1111, currency: "UAH" },
          lineTotal: { amount: 7777, currency: "UAH" },
        }),
      ]),
      subtotal: { amount: 8888, currency: "UAH" },
    };
    const html = renderToStaticMarkup(<CartDrawerView {...props(ready(cart))} />);
    expect(html).toContain('aria-label="Items in the cart"');
    expect(html).toContain("Screwdriver");
    expect(html).toContain("77.77");
    expect(html).toContain("88.88");
    expect(html).not.toContain("33.33");
    expect(html).toContain('href="/en/cart"');
    expect(html).toContain('href="/en/checkout"');
    expect(html).toContain("Decrease quantity of Screwdriver");
  });
  it("makes View cart secondary while keeping Checkout primary", () => {
    const tree = CartDrawerView(props(ready(cartOf([cartLine("drawer")]))));
    const viewCart = findElements(tree, (element) => element.props.href === "/en/cart");
    const checkout = findElements(tree, (element) => element.props.href === "/en/checkout");
    expect(viewCart).toHaveLength(1);
    expect(checkout).toHaveLength(1);
    const secondaryClasses = String(viewCart[0]?.props.className).split(" ");
    expect(secondaryClasses).toEqual(
      expect.arrayContaining([
        "border",
        "border-border",
        "bg-background",
        "text-foreground",
        "hover:bg-muted",
        "min-h-11",
        "rounded-control",
        "px-4",
        "py-2",
        "font-medium",
        "focus-visible:outline-ring",
      ]),
    );
    expect(secondaryClasses).not.toContain("bg-primary");
    expect(String(checkout[0]?.props.className).split(" ")).toEqual(
      expect.arrayContaining(["bg-primary", "text-primary-foreground"]),
    );
  });
  it("marks both navigation links busy with saving wording", () => {
    const input = { ...props(ready(cartOf([cartLine("drawer")]))), leaving: true };
    const tree = CartDrawerView(input);
    for (const [path, handler] of [
      ["/en/cart", input.onViewCart],
      ["/en/checkout", input.onCheckout],
    ] as const) {
      const link = findElements(tree, (element) => element.props.href === path)[0];
      expect(link?.props["aria-busy"]).toBe(true);
      expect(link?.props["aria-disabled"]).toBe(true);
      expect(link?.props.children).toBe(t("cart.checkout.saving"));
      expect(link?.props.onClick).toBe(handler);
    }
  });
  it("uses a standalone plural stock message for only the blocked lines", () => {
    const cart = cartOf([
      cartLine("stock-one", { insufficientStock: true, maxQuantity: 0 }),
      cartLine("stock-two", { insufficientStock: true, maxQuantity: 1 }),
      cartLine("available"),
    ]);
    const html = renderToStaticMarkup(<CartDrawerView {...props(ready(cart))} />);
    expect(html).toContain("Change 2 items to continue.");
    expect(html).not.toContain("Change them to continue:");
    expect(html).not.toContain("style=");
  });
  it("blocks checkout for stock and unavailable lines", () => {
    for (const line of [
      cartLine("stock", { insufficientStock: true, maxQuantity: 0 }),
      cartLine("gone", { notices: [{ code: "unavailable" }], unitPrice: null, lineTotal: null }),
    ]) {
      const cart = cartOf([line]);
      if (line.unitPrice === null) cart.purchasable = false;
      const html = renderToStaticMarkup(<CartDrawerView {...props(ready(cart))} />);
      expect(html).not.toContain('href="/en/checkout"');
      expect(html).toContain('id="drawer-checkout-reason"');
    }
  });
});

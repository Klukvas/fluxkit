import type { Cart, CartLine } from "@fluxkit/api-client";
import { Button, createTranslator, QuantityInput } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { initialCartState, type CartState } from "../lib/cart-store";
import { formatMoney } from "../lib/money";
import { cartLine, cartOf } from "../lib/test-fixtures";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { CartLineView, CartPageView, LineQuantityView, type CartPageViewProps } from "./cart-page";
import { idleAutosave } from "../lib/quantity-autosave";
import {
  findElements,
  leftoverText,
  sentinelTranslator,
  textAttributes,
  textOf,
} from "./test-helpers";

const t = sentinelTranslator();
const hosts = ["cdn.example.com"];

const money = (amount: number, currency = "UAH") => formatMoney({ amount, currency }, 2, "uk");

function handlers() {
  return {
    onRetry: vi.fn(),
    onSetQuantity: vi.fn(),
    onRemove: vi.fn(),
    onAcknowledge: vi.fn(),
    onDismissFailure: vi.fn(),
  };
}

function ready(cart: Cart, overrides: Partial<CartState> = {}): CartState {
  return { ...initialCartState, status: "ready", cart, ...overrides };
}

function props(
  state: CartState,
  overrides: Partial<Pick<CartPageViewProps, "t" | "locale" | "exponent" | "imageHosts">> = {},
): CartPageViewProps & ReturnType<typeof handlers> {
  return {
    state,
    t,
    locale: "uk",
    exponent: 2,
    imageHosts: hosts,
    ...handlers(),
    ...overrides,
  };
}

function view(state: CartState, overrides: Parameters<typeof props>[1] = {}): string {
  return renderToStaticMarkup(<CartPageView {...props(state, overrides)} />);
}

/** Money and API data (titles, SKUs, option names) are not translatable text: take them out before looking for stray words. */
function withoutData(html: string, amounts: number[]): string {
  let result = html;
  for (const amount of amounts) result = result.replaceAll(money(amount), "");
  // The plus and minus glyphs of the quantity buttons (aria-hidden; the buttons carry translated labels).
  return result.replaceAll("\u2212", "").replaceAll("+", "");
}

const priceChanged = (previousAmount = 1500): CartLine["notices"] => [
  { code: "price_changed", previousAmount: { amount: previousAmount, currency: "UAH" } },
];

const unavailableLine = cartLine("gone", {
  title: "§gone",
  unitPrice: null,
  lineTotal: null,
  availability: "out_of_stock",
  notices: [{ code: "unavailable" }],
});

const mixedCart = cartOf(
  [
    cartLine("a", {
      title: "§a",
      sku: "§sku-a",
      quantity: 3,
      notices: priceChanged(),
      unitPrice: { amount: 1999, currency: "UAH" },
      lineTotal: { amount: 7777, currency: "UAH" },
    }),
    cartLine("b", {
      title: "§b",
      sku: "§sku-b",
      notices: [{ code: "out_of_stock" }],
      availability: "out_of_stock",
    }),
    cartLine("c", {
      title: "§c",
      sku: "§sku-c",
      notices: [{ code: "line_total_out_of_range" }],
      unitPrice: null,
      lineTotal: null,
    }),
    unavailableLine,
  ],
  {
    subtotal: { amount: 4242, currency: "UAH" },
    total: { amount: 4343, currency: "UAH" },
    purchasable: false,
    itemCount: 6,
  },
);

describe("CartPageView: states", () => {
  it("is a labelled loading state with a skeleton before the first answer", () => {
    const html = view(initialCartState);
    expect(html).toContain("<h1");
    expect(html).toContain("§cart.title");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("§cart.loading");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("§cart.checkout");
  });

  it("is an error state with the translated message and a retry that is wired to onRetry", () => {
    const state: CartState = {
      ...initialCartState,
      status: "error",
      failure: {
        messageKey: "errors.service_unavailable",
        status: 503,
        code: "service_unavailable",
        retryAfterSeconds: null,
        fieldErrors: [],
      },
    };
    const given = props(state);
    const html = renderToStaticMarkup(<CartPageView {...given} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("§errors.service_unavailable");
    expect(html).not.toContain("English");
    const [retry] = findElements(
      CartPageView(given),
      (element) =>
        element.type === Button && textOf(element.props.children as never) === "§cart.retry",
    );
    expect(retry).toBeDefined();
    (retry?.props.onClick as () => void)();
    expect(given.onRetry).toHaveBeenCalledTimes(1);
  });

  it("is an empty state with a link to the catalog and no summary or checkout", () => {
    const html = view(
      ready(
        cartOf([], {
          itemCount: 0,
          subtotal: { amount: 0, currency: "UAH" },
          total: { amount: 0, currency: "UAH" },
        }),
      ),
    );
    expect(html).toContain("§cart.empty.title");
    expect(html).toContain('href="/uk/catalog"');
    expect(html).not.toContain("§cart.checkout");
    expect(html).not.toContain("§cart.summary.title");
  });

  it("keeps a live region mounted in every state, so a later change is announced", () => {
    for (const state of [initialCartState, ready(cartOf([cartLine("a", { title: "§a" })]))]) {
      expect(view(state)).toMatch(/<div role="status" aria-live="polite" aria-atomic="true"/);
    }
  });

  it("announces what the last action did, with the count and total of the server's cart", () => {
    const real = createTranslator(en, "en");
    const state = ready(
      cartOf([cartLine("a", { title: "§a", quantity: 2 })], {
        itemCount: 2,
        total: { amount: 3998, currency: "UAH" },
      }),
      {
        announcement: "updated",
      },
    );
    const html = renderToStaticMarkup(
      <CartPageView {...props(state, { t: real, locale: "en" })} />,
    );
    expect(html).toMatch(/aria-live="polite"[^>]*>Cart updated\. Items: 2\. Total: [^<]*39\.98/);
  });
});

describe("CartPageView: lines and notices", () => {
  const html = view(ready(mixedCart));

  it("shows every number from the API and none computed here", () => {
    // The line total (7777) is deliberately not unit price times quantity, the subtotal not a sum of anything.
    expect(html).toContain(money(7777));
    expect(html).toContain(money(4242));
    expect(html).toContain(money(4343));
    expect(html).not.toContain(money(1999 * 3));
    expect(html).not.toContain(money(1999 + 1999));
  });

  it("shows the count of items from the API's itemCount", () => {
    expect(html).toContain("§cart.count:6");
  });

  it("marks a changed price with the previous and the current price", () => {
    const real = createTranslator(en, "en");
    const text = renderToStaticMarkup(
      <CartPageView {...props(ready(mixedCart), { t: real, locale: "en" })} />,
    );
    expect(text).toContain("Price changed");
    expect(text).toMatch(/Was [^<]*15\.00, now [^<]*19\.99/);
  });

  it("shows an unavailable line without a price and without a quantity box, but with remove", () => {
    const line = renderToStaticMarkup(
      <CartLineView
        line={unavailableLine}
        currency="UAH"
        busy={false}
        t={t}
        locale="uk"
        exponent={2}
        imageHosts={hosts}
        onSetQuantity={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(line).toContain("§cart.notice.unavailable");
    expect(line).toContain("§cart.notice.unavailable.hint");
    expect(line).not.toContain("§cart.line.unitPrice");
    expect(line).not.toContain("§cart.line.total");
    expect(line).not.toContain('type="number"');
    expect(line).toContain("§cart.line.quantityFixed");
    expect(line).toContain("§cart.line.remove");
  });

  it("shows the out-of-stock badge and the out-of-range hint", () => {
    expect(html).toContain("§availability.out_of_stock");
    expect(html).toContain("§cart.notice.outOfStock.hint");
    expect(html).toContain("§cart.notice.outOfRange");
    expect(html).toContain("§cart.notice.outOfRange.hint");
  });

  it("lets a line over the money limit change its quantity (that is the repair) and remove it", () => {
    const line = renderToStaticMarkup(
      <CartLineView
        line={cartLine("c", {
          title: "§c",
          unitPrice: null,
          lineTotal: null,
          notices: [{ code: "line_total_out_of_range" }],
        })}
        currency="UAH"
        busy={false}
        t={t}
        locale="uk"
        exponent={2}
        imageHosts={hosts}
        onSetQuantity={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(line).toContain('type="number"');
    // No "Update" button any more: the quantity saves itself (2026-11-02).
    expect(line).not.toContain("§cart.line.update");
    expect(line).not.toContain('type="submit"');
    expect(line).toContain("§cart.line.remove");
  });

  it("formats a price seen in another currency with that currency's own digits, not the shop's", () => {
    const real = createTranslator(en, "en");
    const other = cartLine("j", {
      title: "§j",
      notices: [{ code: "price_changed", previousAmount: { amount: 1500, currency: "JPY" } }],
    });
    const text = renderToStaticMarkup(
      <CartPageView {...props(ready(cartOf([other])), { t: real, locale: "en" })} />,
    );
    expect(text).toMatch(/Was [^<]*1,500, now/);
    expect(text).not.toMatch(/Was [^<]*15\.00/);
  });

  it("links the title to the product page and shows the SKU and each option as 'name: value'", () => {
    const real = createTranslator(en, "en");
    const line = cartLine("a", {
      title: "A",
      productSlug: "a b",
      optionValues: [{ option: "Flavor", value: "Mint" }],
    });
    const text = renderToStaticMarkup(
      <CartPageView {...props(ready(cartOf([line])), { t: real, locale: "en" })} />,
    );
    expect(text).toContain('href="/en/p/a%20b"');
    expect(text).toContain("Flavor: Mint");
    expect(text).toContain("SKU: SKU-a");
  });

  it("disables the controls of a line while its write is in flight", () => {
    const busy = view(ready(cartOf([cartLine("a", { title: "§a" })]), { busy: ["a"] }));
    expect(busy).toContain('aria-busy="true"');
    expect(busy.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    const idle = view(ready(cartOf([cartLine("a", { title: "§a" })])));
    expect(idle).not.toContain('aria-busy="true"');
  });

  it("loads a line image only from an allowed host, else the placeholder", () => {
    const allowed = view(
      ready(
        cartOf([
          cartLine("a", {
            title: "§a",
            image: { url: "https://cdn.example.com/a.jpg", alt: "§alt" },
          }),
        ]),
      ),
    );
    expect(allowed).toContain("/_next/image?url=");
    expect(allowed).toContain('alt="§alt"');
    const foreign = view(
      ready(
        cartOf([
          cartLine("a", { title: "§a", image: { url: "https://evil.example/a.jpg", alt: null } }),
        ]),
      ),
    );
    expect(foreign).not.toContain("<img");
    expect(foreign).not.toContain("evil.example");
    const none = view(ready(cartOf([cartLine("a", { title: "§a" })])));
    expect(none).not.toContain("<img");
  });
});

describe("CartPageView on a phone (mobile batch, review D-09)", () => {
  it("keeps the total and the checkout control in one bar that sticks to the bottom below md", () => {
    const html = view(ready(cartOf([cartLine("a", { title: "§a" })])));
    const bar =
      /<div class="fk-sticky-bottom fk-bottom-bar[^"]*max-md:sticky max-md:bottom-0[^"]*">(.*?)<\/div><ul aria-label="§trust\.label"/.exec(
        html,
      );
    expect(bar).not.toBeNull();
    expect(bar?.[1]).toContain("§cart.summary.total");
    expect(bar?.[1]).toContain('href="/uk/checkout"');
  });
});

describe("CartPageView: banner, acknowledge, checkout", () => {
  it("shows the prices-changed banner only when a line has a price_changed notice", () => {
    expect(view(ready(mixedCart))).toContain("§cart.banner.title");
    expect(view(ready(cartOf([cartLine("a", { title: "§a" })])))).not.toContain(
      "§cart.banner.title",
    );
  });

  it("calls POST acknowledge through the OK button, which is disabled while a whole-cart write runs", () => {
    const given = props(ready(mixedCart));
    const [ok] = findElements(
      CartPageView(given),
      (element) =>
        element.type === Button && textOf(element.props.children as never) === "§cart.banner.ok",
    );
    expect(ok).toBeDefined();
    expect(ok?.props.disabled).toBe(false);
    (ok?.props.onClick as () => void)();
    expect(given.onAcknowledge).toHaveBeenCalledTimes(1);
    const busy = findElements(
      CartPageView(props(ready(mixedCart, { busy: ["cart"] }))),
      (element) =>
        element.type === Button && textOf(element.props.children as never) === "§cart.banner.ok",
    );
    expect(busy[0]?.props.disabled).toBe(true);
  });

  it("wires each remove button to its own variant", () => {
    const given = props(
      ready(cartOf([cartLine("a", { title: "§a" }), cartLine("b", { title: "§b" })])),
    );
    const removes = findElements(
      CartPageView(given),
      (element) =>
        element.type === Button &&
        textOf(element.props.children as never) === "§cart.line.removeText",
      [CartLineView],
    );
    expect(removes).toHaveLength(2);
    (removes[0]?.props.onClick as () => void)();
    (removes[1]?.props.onClick as () => void)();
    expect(given.onRemove.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("links to the checkout while the cart is purchasable", () => {
    const html = view(ready(cartOf([cartLine("a", { title: "§a" })])));
    expect(html).toContain('href="/uk/checkout"');
    expect(html).not.toContain("§cart.checkout.blocked");
  });

  it("replaces the checkout link by a disabled button with a visible reason while it is not", () => {
    const html = view(ready(mixedCart));
    expect(html).not.toContain('href="/uk/checkout"');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-describedby="cart-checkout-reason"|<button[^>]*aria-describedby="cart-checkout-reason"[^>]*disabled=""/,
    );
    expect(html).toContain('id="cart-checkout-reason"');
    expect(html).toContain("§cart.checkout.blocked");
  });

  it("shows a failed write with the previous cart still on the page, and dismisses it", () => {
    const state = ready(cartOf([cartLine("a", { title: "§a" })]), {
      failure: {
        messageKey: "errors.too_many_requests",
        status: 429,
        code: "too_many_requests",
        retryAfterSeconds: 12,
        fieldErrors: [],
      },
    });
    const given = props(state);
    const html = renderToStaticMarkup(<CartPageView {...given} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("§errors.too_many_requests");
    expect(html).toContain("§errors.retryAfter:12");
    expect(html).toContain("§a");
    const [dismiss] = findElements(
      CartPageView(given),
      (element) =>
        element.type === Button &&
        textOf(element.props.children as never) === "§cart.failure.dismiss",
    );
    (dismiss?.props.onClick as () => void)();
    expect(given.onDismissFailure).toHaveBeenCalledTimes(1);
  });
});

describe("CartPageView: stock hints of the API (insufficientStock, maxQuantity; plan 2026-11-03)", () => {
  const short = cartLine("big", {
    title: "§big",
    quantity: 999,
    insufficientStock: true,
    maxQuantity: null,
  });
  const few = cartLine("few", {
    title: "§few",
    quantity: 8,
    insufficientStock: true,
    maxQuantity: 3,
  });
  const none = cartLine("none", {
    title: "§none",
    availability: "out_of_stock",
    notices: [{ code: "out_of_stock" }],
    insufficientStock: true,
    maxQuantity: 0,
  });
  const fine = cartLine("fine", { title: "§fine", availability: "low_stock", quantity: 2 });
  const lineHtml = (line: CartLine) =>
    renderToStaticMarkup(
      <CartLineView
        line={line}
        currency="UAH"
        busy={false}
        t={t}
        locale="uk"
        exponent={2}
        imageHosts={hosts}
        onSetQuantity={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

  it("says 'not enough stock, reduce or remove' without a count (999 of 22)", () => {
    const html = lineHtml(short);
    expect(html).toContain("§cart.stock.badge");
    expect(html).toContain("§cart.stock.short");
    expect(html).not.toContain("§cart.stock.only");
  });

  it("names the count when the API gives one and stops the + button at it, never a typed number (review m1)", () => {
    const html = lineHtml(few);
    expect(html).toContain("§cart.stock.only");
    // A typed number above the hint goes to the server (the judge; the hint may be older than a restock).
    expect(html).toMatch(/<input[^>]*type="number"[^>]*max="999"/);
    // The stepper itself (the server render of a line is disabled until its autosave exists).
    const stepper = (quantity: number, stepMax: number) =>
      renderToStaticMarkup(
        LineQuantityView({
          title: "§few",
          variantId: "few",
          quantity,
          autosave: idleAutosave,
          disabled: false,
          t,
          onChange: vi.fn(),
          stepMax,
        }),
      );
    const increaseDisabled = /<button[^>]*aria-label="§cart\.line\.increase"[^>]*disabled=""/;
    expect(stepper(8, 3)).toMatch(increaseDisabled);
    expect(stepper(8, 3)).toMatch(/<input[^>]*max="999"/);
    expect(stepper(30, 999)).not.toMatch(increaseDisabled);
  });

  it("announces a line's stock hint politely when it changes (review m5)", () => {
    expect(lineHtml(few)).toMatch(
      /<div[^>]*aria-live="polite"[^>]*>(?:(?!<\/div>).)*§cart\.stock\.only/s,
    );
    // The region is there before a hint appears, so the change is announced.
    expect(lineHtml(cartLine("plain", { title: "§plain" }))).toContain('aria-live="polite"');
  });

  it("tells an out-of-stock line to be removed instead of 'may be refused'", () => {
    const html = lineHtml(none);
    expect(html).toContain("§availability.out_of_stock");
    expect(html).toContain("§cart.stock.none");
    expect(html).not.toContain("§cart.notice.outOfStock.hint");
  });

  it("shows a low-stock line that fits with its badge only (no PR 213 stop-gap note)", () => {
    const html = lineHtml(fine);
    expect(html).toContain("§availability.low_stock");
    expect(html).not.toContain("§cart.stock.");
    expect(html).not.toContain("§cart.notice.lowStock.hint");
  });

  it("gives every line an anchor and blocks the checkout with a link to each offending line", () => {
    const html = view(ready(cartOf([fine, short, few])));
    expect(html).toContain('id="cart-line-big"');
    expect(html).not.toContain('href="/uk/checkout"');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-describedby="cart-checkout-reason"|<button[^>]*aria-describedby="cart-checkout-reason"[^>]*disabled=""/,
    );
    expect(html).toContain("§cart.checkout.stockBlocked");
    // The focus target when the link turns into the blocked button (review m5).
    expect(html).toMatch(
      /id="cart-checkout-reason"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="cart-checkout-reason"/i,
    );
    expect(html).toContain('href="#cart-line-big"');
    expect(html).toContain('href="#cart-line-few"');
    expect(html).not.toContain('href="#cart-line-fine"');
  });

  it("keeps the sticky bar short: one counted reason and one link to the first line; the full list stays in the page (review M1 of PR 216)", () => {
    const html = view(ready(cartOf([fine, short, few])));
    // The bar is the last part of the page.
    const bar = html.slice(html.indexOf("fk-sticky-bottom"));
    const page = html.slice(0, html.indexOf("fk-sticky-bottom"));
    expect(bar).toContain("§cart.checkout.stockBlockedShort");
    expect(bar).toContain("§cart.checkout.firstLine");
    expect(bar.match(/href="#cart-line-/g)).toHaveLength(1);
    expect(bar).toContain('href="#cart-line-big"');
    expect(bar).not.toContain("§cart.checkout.stockBlocked<");
    expect(page).toContain("§cart.checkout.stockBlocked");
    expect(page).toContain('href="#cart-line-big"');
    expect(page).toContain('href="#cart-line-few"');
  });
});

describe("CartPageView while quantities still save (review M1 of PR 211)", () => {
  it("lets the checkout link wait with a visible 'saving' state, and shows a change refused after leaving", () => {
    const onCheckout = vi.fn();
    const waiting = renderToStaticMarkup(
      <CartPageView {...props(ready(cartOf([cartLine("a")])))} onCheckout={onCheckout} leaving />,
    );
    expect(waiting).toMatch(
      /<a [^>]*aria-busy="true"[^>]*aria-disabled="true"[^>]*>§cart\.checkout\.saving<\/a>/,
    );
    const element = CartPageView({ ...props(ready(cartOf([cartLine("a")]))), onCheckout });
    const [link] = findElements(
      element,
      (candidate) => textOf(candidate.props.children as never) === "§cart.checkout",
    );
    (link?.props.onClick as (event: unknown) => void)({ preventDefault() {} });
    expect(onCheckout).toHaveBeenCalledTimes(1);
    const left = renderToStaticMarkup(
      <CartPageView
        {...props(ready(cartOf([cartLine("a")])))}
        leftFailure={{
          messageKey: "errors.rule.quantity_limit",
          status: 409,
          code: "rule_violation",
          retryAfterSeconds: null,
          fieldErrors: [],
        }}
      />,
    );
    expect(left).toContain("§cart.leftFailure");
  });
});

describe("LineQuantityView", () => {
  const base = {
    title: "§a",
    variantId: "v1",
    quantity: 4,
    autosave: idleAutosave,
    disabled: false,
    t,
    onChange: vi.fn(),
  };

  it("is a labelled stepper with the line's limits, no form and no submit button", () => {
    const html = renderToStaticMarkup(LineQuantityView(base));
    expect(html).toContain('aria-label="§cart.line.quantity"');
    expect(html).toContain('aria-label="§cart.line.decrease"');
    expect(html).toContain('aria-label="§cart.line.increase"');
    expect(html).toContain('value="4"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="999"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain("§cart.line.saving");
  });

  it("says it is saving while a change waits, and shows a refused change with its reason as an alert", () => {
    const saving = renderToStaticMarkup(
      LineQuantityView({ ...base, autosave: { draft: 5, pending: true, failure: null } }),
    );
    expect(saving).toContain("§cart.line.saving");
    expect(saving).toContain('aria-busy="true"');
    const failed = renderToStaticMarkup(
      LineQuantityView({
        ...base,
        quantity: 2,
        autosave: {
          draft: null,
          pending: false,
          failure: {
            messageKey: "errors.rule.quantity_limit",
            status: 409,
            code: "rule_violation",
            retryAfterSeconds: null,
            fieldErrors: [],
          },
        },
      }),
    );
    expect(failed).toMatch(/role="alert"[^>]*>§cart\.line\.saveFailed/);
    expect(failed).toContain('value="2"');
  });

  it("disables the stepper only when told to (a whole-cart write), not for its own save", () => {
    const html = renderToStaticMarkup(
      LineQuantityView({ ...base, autosave: { draft: 5, pending: true, failure: null } }),
    );
    expect(html).not.toMatch(/<input[^>]*disabled=""/);
    const locked = renderToStaticMarkup(LineQuantityView({ ...base, disabled: true }));
    expect(locked).toMatch(/<input[^>]*disabled=""/);
  });

  it("hands the stepper's change to onChange (the autosave), with no request of its own", () => {
    const onChange = vi.fn();
    const element = LineQuantityView({ ...base, onChange });
    const [stepper] = findElements(element, (candidate) => candidate.type === QuantityInput);
    (stepper?.props.onChange as (quantity: number) => void)(5);
    expect(onChange).toHaveBeenCalledWith(5);
  });
});

describe("CartPageView: language, headings, accessibility", () => {
  const states = {
    loading: initialCartState,
    error: {
      ...initialCartState,
      status: "error" as const,
      failure: {
        messageKey: "errors.network",
        status: null,
        code: null,
        retryAfterSeconds: null,
        fieldErrors: [],
      },
    },
    empty: ready(cartOf([], { itemCount: 0 })),
    mixed: ready(mixedCart, { announcement: "removed" }),
    stock: ready(
      cartOf([
        cartLine("s", { title: "§s", quantity: 999, insufficientStock: true, maxQuantity: null }),
        cartLine("f", { title: "§f", quantity: 8, insufficientStock: true, maxQuantity: 3 }),
      ]),
    ),
  };

  it("has no hardcoded text in any state", () => {
    for (const [name, state] of Object.entries(states)) {
      const html = withoutData(view(state), [7777, 4242, 4343, 1999, 0]);
      expect(leftoverText(html), name).toBe("");
      for (const value of textAttributes(html))
        expect(value.startsWith("§"), `${name}: ${value}`).toBe(true);
    }
  });

  it("renders with the real Ukrainian and English messages in every state (a missing key would throw)", () => {
    for (const [messages, locale] of [
      [uk, "uk"],
      [en, "en"],
    ] as const) {
      const real = createTranslator(messages, locale);
      for (const state of Object.values(states)) {
        expect(() =>
          renderToStaticMarkup(<CartPageView {...props(state, { t: real, locale })} />),
        ).not.toThrow();
      }
    }
  });

  it("has one h1, and the line titles and the summary are h2", () => {
    const html = view(ready(mixedCart));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/<h2/g)?.length).toBe(5); // four lines and the summary
    expect(html.indexOf("<h1")).toBeLessThan(html.indexOf("<h2"));
    expect(html).toContain('aria-labelledby="cart-summary-heading"');
    expect(html).toContain('id="cart-summary-heading"');
    expect(html).toContain('aria-label="§cart.lines.label"');
  });
});

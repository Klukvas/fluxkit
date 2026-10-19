import { Button } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { checkoutConfig } from "../config/checkout";
import uk from "../messages/uk.json";
import en from "../messages/en.json";
import { createTranslator } from "@fluxkit/ui";
import { initialCartState, type CartState } from "../lib/cart-store";
import { initialCheckoutValues } from "../lib/checkout-form";
import { initialCheckoutState, type CheckoutState } from "../lib/checkout-store";
import { clientFailure, failureFromResult } from "../lib/failure";
import { formatMoney } from "../lib/money";
import { cartLine, cartOf } from "../lib/test-fixtures";
import { CheckoutPageView, type CheckoutPageViewProps } from "./checkout-page";
import {
  findElements,
  leftoverText,
  sentinelTranslator,
  textAttributes,
  textOf,
} from "./test-helpers";

const t = sentinelTranslator();

/** Two lines whose totals do NOT add up to the cart total: the view must show the API's total, never a sum. */
const cart = cartOf(
  [
    cartLine("a", { title: "§title-a", lineTotal: { amount: 1000, currency: "UAH" } }),
    cartLine("b", { title: "§title-b", lineTotal: { amount: 2000, currency: "UAH" }, quantity: 2 }),
  ],
  { subtotal: { amount: 4321, currency: "UAH" }, total: { amount: 4321, currency: "UAH" } },
);

function ready(value = cart): CartState {
  return { ...initialCartState, status: "ready", cart: value };
}

function props(overrides: Partial<CheckoutPageViewProps> = {}): CheckoutPageViewProps {
  return {
    t,
    locale: "uk",
    exponent: 2,
    config: checkoutConfig,
    cartState: ready(),
    checkout: initialCheckoutState,
    signedIn: false,
    values: initialCheckoutValues(checkoutConfig),
    failure: null,
    pending: false,
    summaryRef: null,
    ordersHref: null,
    signInHref: "/uk/account/login?next=%2Fuk%2Fcheckout",
    onValueChange: vi.fn(),
    onSubmit: vi.fn(),
    onAcknowledge: vi.fn(),
    onConfirmTotal: vi.fn(),
    onRetryCart: vi.fn(),
    ...overrides,
  };
}

/** Data in the markup (amounts formatted by Intl, the country name from Intl.DisplayNames), not text of the template. */
function withoutData(html: string): string {
  let rest = html;
  for (const amount of [1000, 2000, 4321]) {
    rest = rest.split(formatMoney({ amount, currency: "UAH" }, 2, "uk")).join(" ");
  }
  return rest.split("Україна").join(" ");
}

const render = (overrides: Partial<CheckoutPageViewProps> = {}) =>
  renderToStaticMarkup(<CheckoutPageView {...props(overrides)} />);

function tagOf(html: string, id: string): string {
  const match = html.match(new RegExp(`<(input|select)[^>]*id="${id}"[^>]*>`));
  expect(match, `control #${id}`).not.toBeNull();
  return (match as RegExpMatchArray)[0];
}

function submitButton(html: string): string {
  // Only the attribute counts (`disabled:opacity-50` is a class).
  return (html.match(/<button[^>]*type="submit"[^>]*>/) as RegExpMatchArray)[0].replace(
    /class="[^"]*"/,
    "",
  );
}

describe("checkout page: states of the cart", () => {
  it("shows a busy skeleton while the cart loads, with one h1", () => {
    const html = render({ cartState: initialCartState });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("§checkout.loading");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain("<form");
  });

  it("shows a retry when the cart could not be read", () => {
    const onRetryCart = vi.fn();
    const state: CartState = {
      ...initialCartState,
      status: "error",
      failure: clientFailure("errors.network"),
    };
    const element = CheckoutPageView(props({ cartState: state, onRetryCart }));
    const [retry] = findElements(element, (node) => node.type === Button);
    (retry?.props.onClick as () => void)();
    expect(onRetryCart).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(element)).toContain("§errors.network");
  });

  it("shows the empty state with a link to the catalog for an empty cart, and no form", () => {
    const html = render({ cartState: ready(cartOf([])) });
    expect(html).toContain("§checkout.empty.title");
    expect(html).toContain('href="/uk/catalog"');
    expect(html).not.toContain("<form");
  });
});

describe("checkout page: the form", () => {
  it("labels every control and gives it the autocomplete token of its meaning", () => {
    const html = render();
    const expected: Record<string, string> = {
      "checkout-email": "email",
      "checkout-phone": "tel",
      "checkout-firstName": "given-name",
      "checkout-lastName": "family-name",
      "checkout-shippingAddress-countryCode": "country",
      "checkout-shippingAddress-region": "address-level1",
      "checkout-shippingAddress-city": "address-level2",
      "checkout-shippingAddress-postalCode": "postal-code",
      "checkout-shippingAddress-line1": "address-line1",
      "checkout-shippingAddress-line2": "address-line2",
    };
    for (const [id, token] of Object.entries(expected)) {
      expect(tagOf(html, id), id).toContain(`autoComplete="${token}"`);
      expect(html, `label of ${id}`).toContain(`for="${id}"`);
    }
    expect(tagOf(html, "checkout-email")).toContain('type="email"');
    expect(tagOf(html, "checkout-phone")).toContain('type="tel"');
    expect(html).toContain("<form");
    expect(html).toContain("noValidate");
  });

  it("asks for a shipping address ONLY when the cart requires shipping", () => {
    const shipping = render();
    expect(shipping).toContain('name="shippingAddress.city"');
    expect(shipping).toContain('<option value="UA" selected="">');
    expect(shipping).not.toContain("§checkout.address.none");
    const digital = render({
      cartState: ready(cartOf([cartLine("a")], { requiresShipping: false })),
    });
    expect(digital).not.toContain("shippingAddress");
    expect(digital).toContain("§checkout.address.none");
  });

  it("marks required fields from the config and the optional ones in their label", () => {
    const html = render();
    expect(tagOf(html, "checkout-shippingAddress-city")).toContain("required");
    expect(tagOf(html, "checkout-shippingAddress-region")).not.toContain("required");
    expect(html).toContain("§checkout.field.optional");
  });

  it("asks a guest for the email and offers sign-in; a customer may leave the email blank", () => {
    const guest = render();
    expect(tagOf(guest, "checkout-email")).toContain("required");
    expect(guest).toContain('href="/uk/account/login?next=%2Fuk%2Fcheckout"');
    const customer = render({ signedIn: true });
    expect(tagOf(customer, "checkout-email")).not.toContain("required");
    expect(customer).toContain("§checkout.field.email.hintCustomer");
    expect(customer).not.toContain("§checkout.signIn");
  });

  it("shows the API's field errors on their fields and in the summary, linked by id", () => {
    const failure = failureFromResult({
      ok: false,
      status: 400,
      retryAfter: null,
      problem: {
        type: "about:blank",
        title: "t",
        status: 400,
        code: "validation_failed",
        detail: "English detail",
        errors: [
          { path: "shippingAddress.city", code: "empty" },
          { path: "shippingAddress", code: "shipping_address_required" },
        ],
      },
    });
    const html = render({ failure });
    expect(tagOf(html, "checkout-shippingAddress-city")).toContain('aria-invalid="true"');
    expect(html).toContain('href="#checkout-shippingAddress-city"');
    expect(html).toContain('href="#checkout-shippingAddress-countryCode"');
    expect(html).toContain("§errors.field.shipping_address_required");
    expect(html).not.toContain("English detail");
  });

  it("disables the submit with an accessible busy state while the order is sent", () => {
    const html = render({ pending: true });
    expect(submitButton(html)).toContain("disabled");
    expect(submitButton(html)).toContain('aria-busy="true"');
    expect(html).toContain("§checkout.submitting");
  });

  it("states the neutral payment wording and never offers paying online", () => {
    const html = render();
    expect(html).toContain("§checkout.payment.note");
    expect(en["checkout.payment.note"]).toMatch(/contact you to arrange payment/);
    expect(en["checkout.payment.note"]).toMatch(/No payment is taken on this site/);
    for (const messages of [en, uk]) {
      expect(JSON.stringify(messages)).not.toMatch(/pay online|card number|оплатити онлайн/i);
    }
  });
});

describe("checkout page: blocks and confirmations", () => {
  it("blocks the submit while prices changed and offers OK (acknowledge)", () => {
    const changed = cartOf(
      [
        cartLine("a", {
          notices: [{ code: "price_changed", previousAmount: { amount: 1500, currency: "UAH" } }],
        }),
      ],
      { total: { amount: 1999, currency: "UAH" } },
    );
    const onAcknowledge = vi.fn();
    const element = CheckoutPageView(props({ cartState: ready(changed), onAcknowledge }));
    const html = renderToStaticMarkup(element);
    expect(submitButton(html)).toContain("disabled");
    expect(submitButton(html)).toContain('aria-describedby="checkout-blocked-reason"');
    expect(html).toContain('id="checkout-blocked-reason"');
    expect(html).toContain("§checkout.blocked.pricesChanged");
    expect(html).toContain("§cart.notice.priceChanged.detail");
    const [ok] = findElements(
      element,
      (node) => node.type === Button && textOf(node.props.children as never) === "§cart.banner.ok",
    );
    (ok?.props.onClick as () => void)();
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it("after cart_changed shows the NEW total from the API and blocks until it is confirmed", () => {
    const onConfirmTotal = vi.fn();
    const checkout: CheckoutState = { ...initialCheckoutState, needsConfirmation: true };
    const element = CheckoutPageView(props({ checkout, onConfirmTotal }));
    const html = renderToStaticMarkup(element);
    expect(submitButton(html)).toContain("disabled");
    expect(html).toContain("§checkout.confirm.title");
    const [confirm] = findElements(
      element,
      (node) =>
        node.type === Button && textOf(node.props.children as never) === "§checkout.confirm.button",
    );
    (confirm?.props.onClick as () => void)();
    expect(onConfirmTotal).toHaveBeenCalledTimes(1);
  });

  it("blocks a cart that is not purchasable and says why", () => {
    const html = render({ cartState: ready(cartOf([cartLine("a")], { purchasable: false })) });
    expect(submitButton(html)).toContain("disabled");
    expect(html).toContain("§checkout.blocked.notPurchasable");
  });

  it("refuses to submit without a secure context and warns when the attempt cannot be kept", () => {
    const insecure = render({ checkout: { ...initialCheckoutState, insecure: true } });
    expect(submitButton(insecure)).toContain("disabled");
    expect(insecure).toContain("§checkout.error.insecureContext");
    const volatile = render({ checkout: { ...initialCheckoutState, attemptPersistent: false } });
    expect(volatile).toContain("§checkout.warning.storage");
    expect(submitButton(volatile)).not.toContain("disabled");
  });

  it("marks the refused lines of checkout_refused, only for the cart they were refused in", () => {
    const errors = [
      { index: 1, code: "insufficient_stock", messageKey: "errors.field.insufficient_stock" },
    ];
    const html = render({ checkout: { ...initialCheckoutState, lineErrors: { cart, errors } } });
    expect(html).toContain('id="checkout-line-1-refusal"');
    expect(html).toContain('aria-describedby="checkout-line-1-refusal"');
    expect(html).not.toContain("checkout-line-0-refusal");
    const other = render({
      checkout: { ...initialCheckoutState, lineErrors: { cart: cartOf([cartLine("a")]), errors } },
    });
    expect(other).not.toContain("refusal");
  });

  it("links a customer at the open-order limit to the order history", () => {
    expect(render({ ordersHref: "/uk/account/orders" })).toContain('href="/uk/account/orders"');
  });
});

describe("checkout page: money and text", () => {
  it("shows the API's subtotal and total, never a sum of the lines", () => {
    const real = createTranslator(uk, "uk");
    const html = renderToStaticMarkup(<CheckoutPageView {...props({ t: real })} />);
    expect(html).toContain(formatMoney({ amount: 4321, currency: "UAH" }, 2, "uk"));
    expect(html).not.toContain(formatMoney({ amount: 3000, currency: "UAH" }, 2, "uk"));
    expect(html).toContain(formatMoney({ amount: 2000, currency: "UAH" }, 2, "uk"));
  });

  it("has no hardcoded text and one h1 followed by h2 sections", () => {
    for (const overrides of [
      {},
      { signedIn: true },
      {
        checkout: {
          ...initialCheckoutState,
          needsConfirmation: true,
          insecure: true,
          attemptPersistent: false,
        },
      },
      { cartState: ready(cartOf([])) },
    ] satisfies Partial<CheckoutPageViewProps>[]) {
      const html = render(overrides);
      expect(leftoverText(withoutData(html))).toBe("");
      for (const attribute of textAttributes(html)) expect(leftoverText(attribute)).toBe("");
      expect(html.match(/<h1/g)).toHaveLength(1);
    }
    const headings = [...render().matchAll(/<h([1-6])/g)].map((match) => Number(match[1]));
    expect(headings[0]).toBe(1);
    for (let index = 1; index < headings.length; index += 1) {
      expect((headings[index] as number) - (headings[index - 1] as number)).toBeLessThanOrEqual(1);
    }
  });

  it("renders in both locales with the real messages", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const html = renderToStaticMarkup(
        <CheckoutPageView {...props({ t: createTranslator(messages, locale), locale })} />,
      );
      expect(html).toContain(messages["checkout.submit"]);
    }
  });
});

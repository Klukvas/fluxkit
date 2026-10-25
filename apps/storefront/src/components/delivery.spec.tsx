import type { ShippingOption } from "@fluxkit/api-client";
import { Button, Input, createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { checkoutConfig } from "../config/checkout";
import { closedCombobox, type ComboboxState } from "../lib/combobox-model";
import { clientFailure } from "../lib/failure";
import { initialCartState, type CartState } from "../lib/cart-store";
import { initialCheckoutValues } from "../lib/checkout-form";
import { initialCheckoutState, type CheckoutState } from "../lib/checkout-store";
import { formatMoney } from "../lib/money";
import { initialShippingState, type ShippingState } from "../lib/shipping-model";
import { cartLine, cartOf, shippingOption, shippingOptionsOf } from "../lib/test-fixtures";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { CheckoutPageView, type CheckoutPageViewProps } from "./checkout-page";
import { DeliverySectionView, type DeliverySectionViewProps } from "./delivery-section";
import {
  LookupComboboxView,
  lookupAnnouncement,
  type LookupComboboxViewProps,
} from "./lookup-combobox";
import {
  findElements,
  leftoverText,
  sentinelTranslator,
  textAttributes,
  textOf,
} from "./test-helpers";

const t = sentinelTranslator();
const UAH = (amount: number) => ({ amount, currency: "UAH" });

// ----------------------------------------------------------------------------- the combobox

function comboProps(overrides: Partial<LookupComboboxViewProps> = {}): LookupComboboxViewProps {
  return {
    t,
    id: "city",
    name: "shipping.cityRef",
    label: "§label",
    required: true,
    text: "",
    combo: closedCombobox,
    options: [],
    status: "idle",
    stale: false,
    total: 0,
    failure: null,
    onTextChange: vi.fn(),
    onKeyDown: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onHighlight: vi.fn(),
    onChoose: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}
const open = (activeIndex: number): ComboboxState => ({ open: true, activeIndex });
const two = [
  { key: "a", text: "§first option" },
  { key: "b", text: "§second option" },
];
const renderCombo = (overrides: Partial<LookupComboboxViewProps> = {}) =>
  renderToStaticMarkup(<LookupComboboxView {...comboProps(overrides)} />);

/** The control tree of the view: `Field` hands it to a render prop, so call that to see the elements. */
function comboTree(overrides: Partial<LookupComboboxViewProps> = {}) {
  const element = LookupComboboxView(comboProps(overrides));
  const render = (element.props as { children: (control: { id: string }) => never }).children;
  return render({ id: "city" });
}

describe("combobox markup (WAI-ARIA combobox with a listbox popup)", () => {
  it("is a labelled combobox that controls a listbox and announces whether it is expanded", () => {
    const html = renderCombo();
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-controls="city-list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('for="city"');
    expect(html).toMatch(/<ul[^>]*id="city-list"[^>]*role="listbox"/);
    expect(html).not.toContain("aria-activedescendant");
  });

  it("opens the list: options with ids, aria-selected on the highlighted one, activedescendant on the box", () => {
    const html = renderCombo({ combo: open(1), options: two, status: "ready", total: 2 });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-activedescendant="city-list-option-1"');
    expect(html).toMatch(/<li[^>]*id="city-list-option-0"[^>]*aria-selected="false"/);
    expect(html).toMatch(/<li[^>]*id="city-list-option-1"[^>]*aria-selected="true"/);
    expect(html.match(/role="option"/g)).toHaveLength(2);
    expect(html).toContain("§first option");
    // The list is not hidden.
    expect(html).not.toMatch(/<ul[^>]*hidden/);
  });

  it("keeps the list hidden and the box collapsed while closed or empty, and never points at a missing option", () => {
    expect(renderCombo({ combo: closedCombobox, options: two, status: "ready", total: 2 })).toMatch(
      /<ul[^>]*hidden/,
    );
    const empty = renderCombo({ combo: open(0), options: [], status: "ready" });
    expect(empty).toContain('aria-expanded="false"');
    expect(empty).not.toContain("aria-activedescendant");
  });

  it("has a polite live region from the start and announces results, nothing found and failures", () => {
    expect(renderCombo()).toMatch(
      /role="status" aria-live="polite" aria-atomic="true" class="sr-only"/,
    );
    expect(
      lookupAnnouncement(t, { status: "idle", options: [], stale: false, failure: null }),
    ).toBe("");
    expect(
      lookupAnnouncement(t, { status: "loading", options: [], stale: false, failure: null }),
    ).toBe("§checkout.shipping.lookup.loading");
    expect(
      lookupAnnouncement(t, { status: "ready", options: two, stale: false, failure: null }),
    ).toBe("§checkout.shipping.lookup.results:2");
    expect(
      lookupAnnouncement(t, { status: "ready", options: [], stale: false, failure: null }),
    ).toBe("§checkout.shipping.lookup.empty");
    expect(
      lookupAnnouncement(t, { status: "ready", options: two, stale: true, failure: null }),
    ).toContain("§checkout.shipping.lookup.stale");
    expect(
      lookupAnnouncement(t, {
        status: "error",
        options: [],
        stale: false,
        failure: clientFailure("errors.network"),
      }),
    ).toBe("§errors.network");
    const real = createTranslator(en, "en");
    expect(
      lookupAnnouncement(real, { status: "ready", options: two, stale: false, failure: null }),
    ).toMatch(/^2 results\. Use the up and down arrow keys/);
  });

  it("shows the states below the box: searching, nothing found, stale, cut list and a failure with a retry", () => {
    const loading = renderCombo({ status: "loading" });
    expect(loading).toContain("§checkout.shipping.lookup.loading");
    expect(loading).toContain('aria-describedby="city-status"');
    expect(renderCombo({ status: "ready" })).toContain("§checkout.shipping.lookup.empty");
    expect(renderCombo({ status: "ready", options: two, total: 2, stale: true })).toContain(
      "§checkout.shipping.lookup.stale",
    );
    expect(renderCombo({ status: "ready", options: two, total: 40 })).toContain(
      "§checkout.shipping.lookup.truncated",
    );
    const onRetry = vi.fn();
    const failed = comboProps({
      status: "error",
      failure: clientFailure("errors.shipping_provider_unavailable"),
      onRetry,
    });
    const html = renderToStaticMarkup(<LookupComboboxView {...failed} />);
    expect(html).toContain("§errors.shipping_provider_unavailable");
    expect(html).toContain("§checkout.shipping.lookup.hintNeedsRetry");
    const [retry] = findElements(comboTree(failed), (node) => node.type === Button);
    (retry?.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("links the hint, the error and the status to the box and marks it invalid", () => {
    const html = renderCombo({ hint: "§hint", error: "§error", status: "loading" });
    expect(html).toContain('aria-describedby="city-hint city-error city-status"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("required");
  });

  it("hands the typed text, the keys, a click and the pointer to its handlers; a press does not blur the box", () => {
    const handlers = {
      onTextChange: vi.fn(),
      onKeyDown: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onHighlight: vi.fn(),
      onChoose: vi.fn(),
    };
    const tree = comboTree({
      combo: open(0),
      options: two,
      status: "ready",
      total: 2,
      ...handlers,
    });
    const [input] = findElements(tree, (node) => node.type === Input);
    (input?.props.onChange as (event: unknown) => void)({ currentTarget: { value: "kyi" } });
    expect(handlers.onTextChange).toHaveBeenCalledWith("kyi");
    const keyEvent = { key: "ArrowDown" };
    (input?.props.onKeyDown as (event: unknown) => void)(keyEvent);
    expect(handlers.onKeyDown).toHaveBeenCalledWith(keyEvent);
    (input?.props.onClick as () => void)();
    (input?.props.onBlur as () => void)();
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    const [, second] = findElements(tree, (node) => node.type === "li");
    const press = { preventDefault: vi.fn() };
    (second?.props.onMouseDown as (event: unknown) => void)(press);
    expect(press.preventDefault).toHaveBeenCalledTimes(1);
    (second?.props.onMouseMove as () => void)();
    expect(handlers.onHighlight).toHaveBeenCalledWith(1);
    (second?.props.onClick as () => void)();
    expect(handlers.onChoose).toHaveBeenCalledWith(1);
  });

  it("shows the carrier's text as text", () => {
    const html = renderCombo({
      combo: open(-1),
      options: [{ key: "x", text: "<img src=x onerror=alert(1)>" }],
      status: "ready",
      total: 1,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

// ----------------------------------------------------------------------------- the delivery section

const COURIER = shippingOption("courier", {
  title: "§courier",
  price: UAH(5000),
  total: UAH(7001),
});
const FREE = shippingOption("free", {
  title: "§free",
  price: UAH(0),
  total: UAH(1999),
});
const COD = shippingOption("cod", {
  title: "§cod",
  kind: "pickup_point",
  providerCode: "fake",
  price: UAH(0),
  payer: "recipient_on_delivery",
  total: UAH(1999),
  estimate: UAH(7500),
});
const STORE = shippingOption("store", {
  title: "§store",
  kind: "store_pickup",
  description: "§open nine to six",
  price: UAH(0),
  total: UAH(1999),
});
const DOWN = shippingOption("down", {
  title: "§down",
  available: false,
  reason: "country_not_served",
  price: null,
  payer: null,
  total: null,
});

function readyShipping(
  options: ShippingOption[],
  extra: Partial<ShippingState> = {},
): ShippingState {
  return {
    ...initialShippingState,
    started: true,
    answer: shippingOptionsOf(options),
    appliedSeq: 1,
    ...extra,
  };
}

function sectionProps(overrides: Partial<DeliverySectionViewProps> = {}): DeliverySectionViewProps {
  const options = overrides.options ?? [COURIER, FREE, COD, STORE, DOWN];
  return {
    t,
    locale: "uk",
    exponent: 2,
    shipping: readyShipping([...options]),
    options,
    methodCode: "courier",
    methodId: "checkout-shipping-methodCode",
    failure: null,
    onSelectMethod: vi.fn(),
    onRetry: vi.fn(),
    pickup: <p>PICKERS</p>,
    ...overrides,
  };
}
/** The `<input type="radio">` tag of one method; attribute order is React's, so tests look at the tag, not the order. */
function radioTag(html: string, value: string): string {
  const tag = html.match(new RegExp(`<input[^>]*type="radio"[^>]*value="${value}"[^>]*>`));
  expect(tag, `radio ${value}`).not.toBeNull();
  return (tag as RegExpMatchArray)[0];
}
const renderSection = (overrides: Partial<DeliverySectionViewProps> = {}) =>
  renderToStaticMarkup(<DeliverySectionView {...sectionProps(overrides)} />);

describe("delivery section", () => {
  it("is a fieldset with an h2 legend that can take the focus, holding one radio per method", () => {
    const html = renderSection();
    expect(html).toMatch(/<fieldset[^>]*id="checkout-shipping-methodCode"[^>]*tabindex="-1"/i);
    expect(html).toMatch(/<legend[^>]*><h2>§checkout\.shipping\.title<\/h2><\/legend>/);
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(radioTag(html, "courier")).toContain("checked");
    expect(radioTag(html, "store")).not.toContain("checked");
    expect(html).toContain("§courier");
    expect(html).toContain("§store");
  });

  it("shows what each method costs: a price, Free, and paid to the carrier with the estimate", () => {
    const html = renderSection();
    expect(html).toContain(formatMoney(UAH(5000), 2, "uk"));
    expect(html).toContain("§checkout.shipping.price.free");
    expect(html).toContain("§checkout.shipping.price.onDeliveryEstimate");
  });

  it("disables a method that cannot be chosen and says why, linked to the radio", () => {
    const html = renderSection();
    expect(radioTag(html, "down")).toContain("disabled");
    expect(radioTag(html, "courier")).not.toContain("disabled");
    expect(html).toContain("§checkout.shipping.unavailable.country_not_served");
    expect(html).toMatch(/aria-describedby="checkout-shipping-methodCode-down-detail"/);
    expect(html).toContain('id="checkout-shipping-methodCode-down-detail"');
  });

  it("tells the shopper when no method can be chosen at all", () => {
    expect(renderSection({ options: [DOWN] })).toContain("§checkout.shipping.noneAvailable");
    expect(renderSection()).not.toContain("§checkout.shipping.noneAvailable");
  });

  it("calls the handler with the code of the radio that changed", () => {
    const onSelectMethod = vi.fn();
    const element = DeliverySectionView(sectionProps({ onSelectMethod }));
    const radios = findElements(
      element,
      (node) => node.type === "input" && node.props.type === "radio",
    );
    const store = radios.find((radio) => radio.props.value === "store");
    (store?.props.onChange as () => void)();
    expect(onSelectMethod).toHaveBeenCalledWith("store");
  });

  it("shows the pickup text of a store pickup, and the pickers of a pickup point, nothing else", () => {
    const store = renderSection({ methodCode: "store" });
    expect(store).toContain("§open nine to six");
    expect(store).toContain("§checkout.shipping.storePickup.title");
    expect(store).not.toContain("PICKERS");
    const point = renderSection({ methodCode: "cod" });
    expect(point).toContain("PICKERS");
    expect(point).not.toContain("§open nine to six");
    const courier = renderSection({ methodCode: "courier" });
    expect(courier).not.toContain("PICKERS");
    expect(courier).not.toContain("§checkout.shipping.storePickup.title");
  });

  it("uses a neutral text when the store pickup has no text, and never shows the text of a method that is not chosen", () => {
    const bare = shippingOption("store", {
      kind: "store_pickup",
      description: null,
      title: "§store",
    });
    expect(renderSection({ options: [bare], methodCode: "store" })).toContain(
      "§checkout.shipping.storePickup.empty",
    );
  });

  it("shows a failed read with a retry that reads again", () => {
    const onRetry = vi.fn();
    const shipping = readyShipping([COURIER], { failure: clientFailure("errors.network") });
    const props = sectionProps({ shipping, options: [COURIER], onRetry });
    const html = renderToStaticMarkup(<DeliverySectionView {...props} />);
    expect(html).toContain("§checkout.shipping.error.title");
    expect(html).toContain("§errors.network");
    expect(html).not.toContain("§checkout.shipping.noneAvailable");
    const [retry] = findElements(DeliverySectionView(props), (node) => node.type === Button);
    (retry?.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("puts the API's error for the method on the group", () => {
    const failure = {
      ...clientFailure("errors.validation_failed"),
      fieldErrors: [
        {
          path: "shipping.methodCode",
          code: "required",
          messageKey: "errors.field.required",
        },
      ],
    };
    const html = renderSection({ failure });
    expect(html).toContain('aria-describedby="checkout-shipping-methodCode-error"');
    expect(html).toContain("§errors.field.required");
  });

  it("renders carrier and shop text as text and has no hardcoded words", () => {
    const hostile = shippingOption("courier", {
      title: "<img src=x onerror=alert(1)>",
      description: "<script>alert(1)</script>",
    });
    const html = renderSection({ options: [hostile] });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    const clean = renderSection({ methodCode: "store" });
    const rest = clean.split(formatMoney(UAH(5000), 2, "uk")).join(" ");
    expect(leftoverText(rest.replace(/§[^<]*/g, " "))).toBe("");
    for (const attribute of textAttributes(clean)) expect(leftoverText(attribute)).toBe("");
  });
});

// ----------------------------------------------------------------------------- the checkout with methods

const cart = cartOf([cartLine("a", { title: "§title-a" })], {
  subtotal: UAH(1999),
  total: UAH(1999),
});

function ready(value = cart): CartState {
  return { ...initialCartState, status: "ready", cart: value };
}

function pageProps(overrides: Partial<CheckoutPageViewProps> = {}): CheckoutPageViewProps {
  return {
    t,
    locale: "uk",
    exponent: 2,
    config: checkoutConfig,
    cartState: ready(),
    checkout: initialCheckoutState,
    shipping: readyShipping([COURIER, COD, STORE]),
    pickup: <p>PICKERS</p>,
    signedIn: false,
    values: { ...initialCheckoutValues(checkoutConfig), "shipping.methodCode": "courier" },
    failure: null,
    pending: false,
    summaryRef: null,
    ordersHref: null,
    signInHref: "/uk/account/login?next=%2Fuk%2Fcheckout",
    onValueChange: vi.fn(),
    onSubmit: vi.fn(),
    onAcknowledge: vi.fn(),
    onConfirmTotal: vi.fn(),
    onConfirmShipping: vi.fn(),
    onSelectMethod: vi.fn(),
    onRetryShipping: vi.fn(),
    onRetryCart: vi.fn(),
    ...overrides,
  };
}
const renderPage = (overrides: Partial<CheckoutPageViewProps> = {}) =>
  renderToStaticMarkup(<CheckoutPageView {...pageProps(overrides)} />);
const withMethod = (code: string) => ({
  values: { ...initialCheckoutValues(checkoutConfig), "shipping.methodCode": code },
});
const submit = (html: string) =>
  (html.match(/<button[^>]*type="submit"[^>]*>/) as RegExpMatchArray)[0].replace(
    /class="[^"]*"/,
    "",
  );

describe("checkout page with shipping methods", () => {
  it("puts the delivery section before the address and shows the address fields only for a method that delivers to an address", () => {
    const html = renderPage();
    expect(html.indexOf("§checkout.shipping.title")).toBeGreaterThan(-1);
    expect(html.indexOf("§checkout.shipping.title")).toBeLessThan(
      html.indexOf("§checkout.address.title"),
    );
    expect(html).toContain('name="shippingAddress.city"');
    for (const code of ["cod", "store"]) {
      const other = renderPage(withMethod(code));
      expect(other, code).not.toContain("shippingAddress");
      expect(other, code).not.toContain("§checkout.address.title");
    }
    expect(renderPage(withMethod("cod"))).toContain("PICKERS");
  });

  it("shows the subtotal, the delivery and the SERVER's total of the chosen method, never a sum", () => {
    const html = renderPage();
    const real = renderToStaticMarkup(
      <CheckoutPageView {...pageProps({ t: createTranslator(uk, "uk") })} />,
    );
    // 7001 is not 1999 + 5000: the page shows the API's number.
    expect(real).toContain(formatMoney(UAH(7001), 2, "uk"));
    expect(real).toContain(formatMoney(UAH(1999), 2, "uk"));
    expect(real).toContain(formatMoney(UAH(5000), 2, "uk"));
    expect(real).not.toContain(formatMoney(UAH(6999), 2, "uk"));
    expect(html).toContain("§checkout.summary.shipping");
  });

  it("shows the total of the other chosen method, and 'not chosen' before a choice", () => {
    const store = renderToStaticMarkup(
      <CheckoutPageView
        {...pageProps({ t: createTranslator(uk, "uk"), ...withMethod("store") })}
      />,
    );
    expect(store).toContain(createTranslator(uk, "uk")("checkout.shipping.price.free"));
    const none = renderPage(withMethod(""));
    expect(none).toContain("§checkout.summary.shipping.notChosen");
    expect(none).toContain("§checkout.summary.total.pending");
    expect(submit(none)).toContain("disabled");
    expect(none).toContain("§checkout.blocked.shippingMethod");
  });

  it("blocks the submit with a reason while the price is being read again, and keeps showing the last price", () => {
    const html = renderToStaticMarkup(
      <CheckoutPageView
        {...pageProps({
          t: createTranslator(uk, "uk"),
          shipping: readyShipping([COURIER, COD, STORE], { pending: true }),
        })}
      />,
    );
    expect(submit(html)).toContain("disabled");
    expect(html).toContain(uk["checkout.blocked.shippingLoading"]);
    expect(html).toContain(formatMoney(UAH(7001), 2, "uk"));
  });

  it("shows a skeleton instead of a form while it does not know whether the shop has methods, and blocks the submit", () => {
    const html = renderPage({ shipping: initialShippingState });
    expect(html).toContain("§checkout.shipping.loading");
    expect(html).not.toContain('name="shippingAddress.city"');
    expect(html).not.toContain("§checkout.address.title");
    expect(submit(html)).toContain("disabled");
  });

  it("shows the error of the first read with a retry instead of guessing", () => {
    const html = renderPage({
      shipping: {
        ...initialShippingState,
        started: true,
        failure: clientFailure("errors.network"),
      },
    });
    expect(html).toContain("§checkout.shipping.error.title");
    expect(submit(html)).toContain("disabled");
    expect(html).toContain("§checkout.blocked.shippingError");
  });

  it("asks the shopper to agree to a new delivery price, with the old total, and blocks the submit until then", () => {
    const onConfirmShipping = vi.fn();
    const checkout: CheckoutState = {
      ...initialCheckoutState,
      shippingConsent: {
        methodCode: "courier",
        previousTotal: UAH(6000),
        previousPrice: UAH(4001),
      },
    };
    const props = pageProps({ checkout, onConfirmShipping });
    const element = CheckoutPageView(props);
    const html = renderToStaticMarkup(element);
    expect(html).toContain("§checkout.shippingChanged.title");
    expect(html).toContain("§checkout.shippingChanged.body");
    expect(submit(html)).toContain("disabled");
    const [agree] = findElements(
      element,
      (node) =>
        node.type === Button &&
        textOf(node.props.children as never) === "§checkout.shippingChanged.button",
    );
    (agree?.props.onClick as () => void)();
    expect(onConfirmShipping).toHaveBeenCalledTimes(1);
    const real = renderToStaticMarkup(
      <CheckoutPageView
        {...pageProps({ checkout, t: createTranslator(en, "en"), locale: "en" })}
      />,
    );
    expect(real).toContain("The order total is now");
    expect(real).toContain(formatMoney(UAH(7001), 2, "en"));
    expect(real).toContain(formatMoney(UAH(6000), 2, "en"));
  });

  it("says so when the method the shopper agreed to is not available any more", () => {
    const gone = shippingOption("courier", {
      title: "§courier",
      available: false,
      reason: "inactive",
      price: null,
      payer: null,
      total: null,
    });
    const html = renderPage({
      shipping: readyShipping([gone, STORE]),
      checkout: {
        ...initialCheckoutState,
        shippingConsent: {
          methodCode: "courier",
          previousTotal: UAH(6000),
          previousPrice: UAH(4001),
        },
      },
    });
    expect(html).toContain("§checkout.shippingChanged.unavailable");
    expect(html).not.toContain("§checkout.shippingChanged.button");
    expect(submit(html)).toContain("disabled");
  });

  it("is EXACTLY the checkout without shipping when the shop has no method: no delivery section, the cart's total", () => {
    const html = renderToStaticMarkup(
      <CheckoutPageView
        {...pageProps({
          t: createTranslator(uk, "uk"),
          shipping: readyShipping([]),
          values: initialCheckoutValues(checkoutConfig),
        })}
      />,
    );
    expect(html).not.toContain(uk["checkout.shipping.title"]);
    expect(html).not.toContain(uk["checkout.summary.shipping"]);
    expect(html).toContain('name="shippingAddress.city"');
    expect(html).toContain(formatMoney(UAH(1999), 2, "uk"));
    expect(submit(html)).not.toContain("disabled");
  });

  it("keeps the delivery out of the way of a cart that ships nothing", () => {
    const digital = cartOf([cartLine("d")], { requiresShipping: false });
    const html = renderPage({ cartState: ready(digital), shipping: initialShippingState });
    expect(html).not.toContain("§checkout.shipping.title");
    expect(html).toContain("§checkout.address.none");
    expect(submit(html)).not.toContain("disabled");
  });

  it("lists the countries the methods serve, not the config's", () => {
    const html = renderPage({
      shipping: readyShipping([shippingOption("courier", { countryCodes: ["PL", "DE"] })]),
      values: {
        ...initialCheckoutValues(checkoutConfig),
        "shipping.methodCode": "courier",
        "shippingAddress.countryCode": "PL",
      },
    });
    expect(html).toContain('<option value="PL" selected="">');
    expect(html).toContain('<option value="DE">');
    expect(html).not.toContain('<option value="UA"');
  });

  it("has no hardcoded text in any delivery state, one h1 and no heading level skipped", () => {
    const states: Partial<CheckoutPageViewProps>[] = [
      {},
      withMethod("cod"),
      withMethod("store"),
      withMethod(""),
      { shipping: readyShipping([COURIER], { pending: true }) },
      { shipping: initialShippingState },
      {
        shipping: {
          ...initialShippingState,
          started: true,
          failure: clientFailure("errors.network"),
        },
      },
      {
        checkout: {
          ...initialCheckoutState,
          shippingConsent: {
            methodCode: "courier",
            previousTotal: UAH(6000),
            previousPrice: UAH(4001),
          },
        },
      },
    ];
    for (const overrides of states) {
      const html = renderPage(overrides);
      let rest = html.split("Україна").join(" ");
      for (const amount of [1999, 5000, 7001, 7500, 6000]) {
        rest = rest.split(formatMoney(UAH(amount), 2, "uk")).join(" ");
      }
      expect(
        leftoverText(rest.replace(/PICKERS/g, " ").replace(/§[^<]*/g, " ")),
        JSON.stringify(Object.keys(overrides)),
      ).toBe("");
      for (const attribute of textAttributes(html)) expect(leftoverText(attribute)).toBe("");
      expect(html.match(/<h1/g)).toHaveLength(1);
      const headings = [...html.matchAll(/<h([1-6])/g)].map((match) => Number(match[1]));
      for (let index = 1; index < headings.length; index += 1) {
        expect((headings[index] as number) - (headings[index - 1] as number)).toBeLessThanOrEqual(
          1,
        );
      }
    }
  });

  it("renders in both locales with the real messages", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const html = renderToStaticMarkup(
        <CheckoutPageView {...pageProps({ t: createTranslator(messages, locale), locale })} />,
      );
      expect(html).toContain(messages["checkout.shipping.title"]);
      expect(html).toContain(messages["checkout.submit"]);
      expect(html).not.toContain("undefined");
    }
  });

  it("links an API error on the pickup point to its field in the summary", () => {
    const failure = {
      ...clientFailure("errors.validation_failed"),
      fieldErrors: [
        {
          path: "shipping.pickupPointRef",
          code: "unknown_pickup_point",
          messageKey: "errors.field.unknown_pickup_point",
        },
      ],
    };
    const html = renderPage({ failure, ...withMethod("cod") });
    expect(html).toContain('href="#checkout-shipping-pickupPointRef"');
    expect(html).toContain("§account.form.errorItem");
  });
});

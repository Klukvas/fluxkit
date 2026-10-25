import { describe, expect, it } from "vitest";
import type { CheckoutConfig } from "../config/checkout";
import { checkoutConfig } from "../config/checkout";
import {
  buildCheckoutBody,
  checkoutFieldIds,
  checkoutFieldOrder,
  countryNames,
  countryOptions,
  initialCheckoutValues,
  prefillFromCustomer,
  requiredCheckoutFields,
  type CheckoutValues,
} from "./checkout-form";
import { customer } from "./test-fixtures";

const total = { amount: 4598, currency: "UAH" };

function filled(overrides: Partial<CheckoutValues> = {}): CheckoutValues {
  return {
    ...initialCheckoutValues(checkoutConfig),
    email: " guest@example.test ",
    phone: "+380 44 123 4567",
    firstName: " Ada ",
    lastName: "Guest",
    "shippingAddress.city": " Kyiv ",
    "shippingAddress.line1": "Street 1",
    ...overrides,
  };
}

describe("initialCheckoutValues", () => {
  it("starts empty with the configured default country", () => {
    const values = initialCheckoutValues(checkoutConfig);
    expect(values["shippingAddress.countryCode"]).toBe("UA");
    expect(values.email).toBe("");
    expect(Object.keys(values)).toEqual(checkoutFieldOrder(true, checkoutConfig));
  });

  it("refuses a default country that is not allowed (a config mistake fails loudly)", () => {
    const broken: CheckoutConfig = { ...checkoutConfig, defaultCountry: "PL" };
    expect(() => initialCheckoutValues(broken)).toThrow(RangeError);
  });
});

describe("buildCheckoutBody", () => {
  const guest = { signedIn: false, requiresShipping: true, locale: "uk", expectedTotal: total };

  it("sends trimmed contact data, the shipping address, the locale and the expected total as given", () => {
    expect(buildCheckoutBody(filled(), guest, checkoutConfig)).toEqual({
      email: "guest@example.test",
      phone: "+380 44 123 4567",
      firstName: "Ada",
      lastName: "Guest",
      shippingAddress: { countryCode: "UA", city: "Kyiv", line1: "Street 1" },
      locale: "uk",
      expectedTotal: { amount: 4598, currency: "UAH" },
    });
  });

  it("leaves blank optional address fields out (the API refuses a sent blank as `empty`)", () => {
    const body = buildCheckoutBody(
      filled({ "shippingAddress.region": "  ", "shippingAddress.postalCode": "01001" }),
      guest,
      checkoutConfig,
    );
    expect(body.shippingAddress).toEqual({
      countryCode: "UA",
      city: "Kyiv",
      postalCode: "01001",
      line1: "Street 1",
    });
  });

  it("sends NO address when the cart needs no shipping, whatever the form holds", () => {
    const body = buildCheckoutBody(filled(), { ...guest, requiresShipping: false }, checkoutConfig);
    expect("shippingAddress" in body).toBe(false);
    expect("billingAddress" in body).toBe(false);
  });

  it("lets a signed-in customer leave the email blank (the account email is used)", () => {
    const body = buildCheckoutBody(
      filled({ email: " " }),
      { ...guest, signedIn: true },
      checkoutConfig,
    );
    expect("email" in body).toBe(false);
    const guestBody = buildCheckoutBody(filled({ email: " " }), guest, checkoutConfig);
    expect(guestBody.email).toBe("");
  });

  it("copies the expected total object and adds or rounds nothing", () => {
    const expectedTotal = { amount: 1, currency: "EUR" };
    const body = buildCheckoutBody(filled(), { ...guest, expectedTotal }, checkoutConfig);
    expect(body.expectedTotal).toEqual(expectedTotal);
    expect(body.expectedTotal).not.toBe(expectedTotal);
  });
});

describe("requiredCheckoutFields and the field order", () => {
  it("requires the email of a guest only, and the address fields only when the cart ships", () => {
    expect(
      requiredCheckoutFields({ signedIn: false, requiresShipping: true }, checkoutConfig),
    ).toEqual([
      "email",
      "phone",
      "firstName",
      "lastName",
      "shippingAddress.countryCode",
      "shippingAddress.city",
      "shippingAddress.line1",
    ]);
    expect(
      requiredCheckoutFields({ signedIn: true, requiresShipping: false }, checkoutConfig),
    ).toEqual(["phone", "firstName", "lastName"]);
  });

  it("lists the fields in page order, address fields in config order, none without shipping", () => {
    expect(checkoutFieldOrder(false, checkoutConfig)).toEqual([
      "email",
      "phone",
      "firstName",
      "lastName",
    ]);
    expect(checkoutFieldOrder(true, checkoutConfig)).toEqual([
      "email",
      "phone",
      "firstName",
      "lastName",
      "shippingAddress.countryCode",
      "shippingAddress.region",
      "shippingAddress.city",
      "shippingAddress.postalCode",
      "shippingAddress.line1",
      "shippingAddress.line2",
    ]);
  });

  it("gives every field an id, and the whole address (`shippingAddress`) the first address field's id", () => {
    const ids = checkoutFieldIds(checkoutConfig);
    expect(ids.email).toBe("checkout-email");
    expect(ids["shippingAddress.city"]).toBe("checkout-shippingAddress-city");
    expect(ids.shippingAddress).toBe("checkout-shippingAddress-countryCode");
  });
});

describe("prefillFromCustomer", () => {
  it("fills empty contact fields from the account and never overwrites what the shopper typed", () => {
    const values = prefillFromCustomer(
      { ...initialCheckoutValues(checkoutConfig), firstName: "Typed" },
      customer({ phone: "+380501112233" }),
    );
    expect(values).toMatchObject({
      email: "shopper@example.test",
      firstName: "Typed",
      lastName: "Shopper",
      phone: "+380501112233",
    });
    expect(prefillFromCustomer(initialCheckoutValues(checkoutConfig), customer()).phone).toBe("");
  });
});

describe("countryOptions", () => {
  it("names the allowed countries with Intl.DisplayNames in the page's locale", () => {
    const config: CheckoutConfig = { ...checkoutConfig, allowedShippingCountries: ["UA", "PL"] };
    expect(countryOptions(config, "en")).toEqual([
      { code: "UA", name: "Ukraine" },
      { code: "PL", name: "Poland" },
    ]);
    expect(countryOptions(config, "uk")[0]).toEqual({ code: "UA", name: "Україна" });
  });
});

describe("delivery fields (shipping plan step 10)", () => {
  const guest = { signedIn: false, requiresShipping: true, locale: "uk", expectedTotal: total };
  const contact = ["email", "phone", "firstName", "lastName"];

  it("orders the fields by what the chosen method needs", () => {
    expect(checkoutFieldOrder(true, checkoutConfig, "none")).toEqual(
      checkoutFieldOrder(true, checkoutConfig),
    );
    expect(checkoutFieldOrder(true, checkoutConfig, "unchosen")).toEqual([
      ...contact,
      "shipping.methodCode",
    ]);
    expect(checkoutFieldOrder(true, checkoutConfig, "store_pickup")).toEqual([
      ...contact,
      "shipping.methodCode",
    ]);
    expect(checkoutFieldOrder(true, checkoutConfig, "pickup_point")).toEqual([
      ...contact,
      "shipping.methodCode",
      "shipping.cityRef",
      "shipping.pickupPointRef",
    ]);
    expect(checkoutFieldOrder(true, checkoutConfig, "address").slice(0, 6)).toEqual([
      ...contact,
      "shipping.methodCode",
      "shippingAddress.countryCode",
    ]);
    // A cart that ships nothing has no delivery fields, whatever the mode says.
    expect(checkoutFieldOrder(false, checkoutConfig, "address")).toEqual(contact);
  });

  it("requires the address for an address method, the city and the point for a pickup point, nothing for a store pickup", () => {
    const required = (delivery: Parameters<typeof checkoutFieldOrder>[2]) =>
      requiredCheckoutFields({ signedIn: true, requiresShipping: true, delivery }, checkoutConfig);
    const base = ["phone", "firstName", "lastName"];
    expect(required("none")).toEqual([
      ...base,
      "shippingAddress.countryCode",
      "shippingAddress.city",
      "shippingAddress.line1",
    ]);
    expect(required("address")).toEqual(required("none"));
    expect(required("pickup_point")).toEqual([
      ...base,
      "shipping.cityRef",
      "shipping.pickupPointRef",
    ]);
    expect(required("store_pickup")).toEqual(base);
    expect(required("unchosen")).toEqual(base);
  });

  it("gives the delivery fields ids for the error summary and the focus", () => {
    const ids = checkoutFieldIds(checkoutConfig);
    expect(ids["shipping.methodCode"]).toBe("checkout-shipping-methodCode");
    expect(ids["shipping.cityRef"]).toBe("checkout-shipping-cityRef");
    expect(ids["shipping.pickupPointRef"]).toBe("checkout-shipping-pickupPointRef");
  });

  it("sends the method with the address for an address method, the point alone for a pickup point, the method alone for a store pickup", () => {
    const address = buildCheckoutBody(
      filled(),
      {
        ...guest,
        delivery: { methodCode: "courier", kind: "address", pickupPointRef: "leftover" },
      },
      checkoutConfig,
    );
    expect(address.shipping).toEqual({ methodCode: "courier" });
    expect(address.shippingAddress).toBeDefined();
    const point = buildCheckoutBody(
      filled(),
      { ...guest, delivery: { methodCode: "branch", kind: "pickup_point", pickupPointRef: "p1" } },
      checkoutConfig,
    );
    expect(point.shipping).toEqual({ methodCode: "branch", pickupPointRef: "p1" });
    expect("shippingAddress" in point).toBe(false);
    const store = buildCheckoutBody(
      filled(),
      { ...guest, delivery: { methodCode: "store", kind: "store_pickup", pickupPointRef: "" } },
      checkoutConfig,
    );
    expect(store.shipping).toEqual({ methodCode: "store" });
    expect("shippingAddress" in store).toBe(false);
  });

  it("sends no shipping member without a delivery, and none for a cart that ships nothing", () => {
    expect("shipping" in buildCheckoutBody(filled(), guest, checkoutConfig)).toBe(false);
    const digital = buildCheckoutBody(
      filled(),
      {
        ...guest,
        requiresShipping: false,
        delivery: { methodCode: "courier", kind: "address", pickupPointRef: "" },
      },
      checkoutConfig,
    );
    expect("shipping" in digital).toBe(false);
    expect("shippingAddress" in digital).toBe(false);
  });
});

describe("countryNames", () => {
  it("names any list of country codes in the page's locale", () => {
    expect(countryNames(["PL", "DE"], "en")).toEqual([
      { code: "PL", name: "Poland" },
      { code: "DE", name: "Germany" },
    ]);
  });
});

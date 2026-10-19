import { describe, expect, it } from "vitest";
import type { CheckoutConfig } from "../config/checkout";
import { checkoutConfig } from "../config/checkout";
import {
  buildCheckoutBody,
  checkoutFieldIds,
  checkoutFieldOrder,
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

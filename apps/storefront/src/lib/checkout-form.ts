import type { AddressInput, CheckoutBody, Customer, Money } from "@fluxkit/api-client";
import type { AddressFieldName, CheckoutConfig } from "../config/checkout";

/**
 * The checkout form as data (plan step 7). Values are keyed by the API's field PATH (`email`,
 * `shippingAddress.city`), so an `errors[]` entry of a `400` lands on its field without a mapping table. Pure: the island
 * holds the values in component state only (never a URL, browser storage or a log) and calls these functions.
 *
 * Billing address (decision, the plan leaves it open): not asked for in v1. The API accepts one but nothing uses it while
 * there is no payment or invoice (owner answer 9: payment is the next plan), and asking for it would collect personal
 * data for no purpose. The recipient fields of the address are not sent either: the order's contact (name, phone) is the
 * recipient. A shop that needs either adds them here and in `config/checkout.ts`.
 */

export type CheckoutValues = Record<string, string>;

export const CONTACT_FIELDS = ["email", "phone", "firstName", "lastName"] as const;
export const COUNTRY_FIELD = "shippingAddress.countryCode";
/** The path of the `shipping_address_required` error (the whole address). */
export const ADDRESS_PATH = "shippingAddress";

export function addressPath(name: AddressFieldName): string {
  return `${ADDRESS_PATH}.${name}`;
}

/** Field paths in page order: contact, then (only when the cart ships) the country and the configured address fields. */
export function checkoutFieldOrder(requiresShipping: boolean, config: CheckoutConfig): string[] {
  return [
    ...CONTACT_FIELDS,
    ...(requiresShipping
      ? [COUNTRY_FIELD, ...config.addressFields.map((field) => addressPath(field.name))]
      : []),
  ];
}

export function checkoutFieldIds(config: CheckoutConfig): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const path of checkoutFieldOrder(true, config)) {
    ids[path] = `checkout-${path.replace(".", "-")}`;
  }
  ids[ADDRESS_PATH] = ids[COUNTRY_FIELD] as string;
  return ids;
}

/**
 * Fields that must not be blank before a request is sent (a UX check only: the API judges every value). A guest needs an
 * email; a signed-in customer may leave it blank (the account email is used).
 */
export function requiredCheckoutFields(
  context: { signedIn: boolean; requiresShipping: boolean },
  config: CheckoutConfig,
): string[] {
  return [
    ...(context.signedIn ? [] : ["email"]),
    "phone",
    "firstName",
    "lastName",
    ...(context.requiresShipping
      ? [
          COUNTRY_FIELD,
          ...config.addressFields
            .filter((field) => field.required)
            .map((field) => addressPath(field.name)),
        ]
      : []),
  ];
}

export function initialCheckoutValues(config: CheckoutConfig): CheckoutValues {
  if (!config.allowedShippingCountries.includes(config.defaultCountry)) {
    throw new RangeError(
      `checkoutConfig.defaultCountry "${config.defaultCountry}" is not in allowedShippingCountries.`,
    );
  }
  const values: CheckoutValues = {};
  for (const path of checkoutFieldOrder(true, config)) values[path] = "";
  values[COUNTRY_FIELD] = config.defaultCountry;
  return values;
}

/** Fills the contact fields the shopper has not typed in yet from the signed-in account; the shopper can still edit them. */
export function prefillFromCustomer(values: CheckoutValues, customer: Customer): CheckoutValues {
  const fromAccount: CheckoutValues = {
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone ?? "",
  };
  const next = { ...values };
  for (const [path, value] of Object.entries(fromAccount)) {
    if ((next[path] ?? "") === "") next[path] = value;
  }
  return next;
}

function value(values: CheckoutValues, path: string): string {
  return (values[path] ?? "").trim();
}

export interface CheckoutBodyContext {
  signedIn: boolean;
  /** The cart's `requiresShipping`: the address is sent only then. */
  requiresShipping: boolean;
  locale: string;
  /** The total of the most recent cart the shopper sees on the page; copied, never computed. */
  expectedTotal: Money;
}

export function buildCheckoutBody(
  values: CheckoutValues,
  context: CheckoutBodyContext,
  config: CheckoutConfig,
): CheckoutBody {
  const email = value(values, "email");
  const body: CheckoutBody = {
    ...(context.signedIn && email === "" ? {} : { email }),
    phone: value(values, "phone"),
    firstName: value(values, "firstName"),
    lastName: value(values, "lastName"),
    locale: context.locale,
    expectedTotal: {
      amount: context.expectedTotal.amount,
      currency: context.expectedTotal.currency,
    },
  };
  if (context.requiresShipping) {
    const address: AddressInput = { countryCode: value(values, COUNTRY_FIELD) };
    for (const field of config.addressFields) {
      const text = value(values, addressPath(field.name));
      // A blank optional field is "not sent"; a sent blank is refused by the API as `empty`.
      if (text !== "" || field.required) address[field.name] = text;
    }
    body.shippingAddress = address;
  }
  return body;
}

/** The allowed countries named in the page's locale (`Intl.DisplayNames`), in config order. */
export function countryOptions(
  config: CheckoutConfig,
  locale: string,
): { code: string; name: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return config.allowedShippingCountries.map((code) => ({ code, name: names.of(code) ?? code }));
}

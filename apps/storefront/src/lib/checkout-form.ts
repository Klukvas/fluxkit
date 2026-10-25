import type {
  AddressInput,
  CheckoutBody,
  Customer,
  Money,
  ShippingMethodKind,
} from "@fluxkit/api-client";
import type { AddressFieldName, CheckoutConfig } from "../config/checkout";
import type { DeliveryMode } from "./shipping-model";

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
/** The delivery choice, keyed by the API's path so a `400` lands on its field (shipping plan step 10). */
export const SHIPPING_METHOD_FIELD = "shipping.methodCode";
/** Sent to nobody: the carrier city only narrows the pickup point lookup and asks for the carrier's estimate. */
export const SHIPPING_CITY_FIELD = "shipping.cityRef";
export const SHIPPING_POINT_FIELD = "shipping.pickupPointRef";
/** The texts of the chosen city and pickup point, kept with the form values so a re-render shows them again. Never sent. */
export const SHIPPING_CITY_NAME_FIELD = "shipping.cityName";
export const SHIPPING_POINT_TEXT_FIELD = "shipping.pointText";

/** The path of the `shipping_address_required` error (the whole address). */
export const ADDRESS_PATH = "shippingAddress";

export function addressPath(name: AddressFieldName): string {
  return `${ADDRESS_PATH}.${name}`;
}

function addressPaths(config: CheckoutConfig): string[] {
  return [COUNTRY_FIELD, ...config.addressFields.map((field) => addressPath(field.name))];
}

/**
 * Field paths in page order: contact, then (only when the cart ships) the delivery fields of the mode. Without shipping
 * methods (`none`) that is the country and the configured address fields, as before shipping existed.
 */
export function checkoutFieldOrder(
  requiresShipping: boolean,
  config: CheckoutConfig,
  delivery: DeliveryMode = "none",
): string[] {
  if (!requiresShipping) return [...CONTACT_FIELDS];
  switch (delivery) {
    case "none":
      return [...CONTACT_FIELDS, ...addressPaths(config)];
    case "unchosen":
    case "store_pickup":
      return [...CONTACT_FIELDS, SHIPPING_METHOD_FIELD];
    case "address":
      return [...CONTACT_FIELDS, SHIPPING_METHOD_FIELD, ...addressPaths(config)];
    case "pickup_point":
      return [...CONTACT_FIELDS, SHIPPING_METHOD_FIELD, SHIPPING_CITY_FIELD, SHIPPING_POINT_FIELD];
  }
}

export function checkoutFieldIds(config: CheckoutConfig): Record<string, string> {
  const ids: Record<string, string> = {};
  const everyField = [
    ...checkoutFieldOrder(true, config, "address"),
    SHIPPING_CITY_FIELD,
    SHIPPING_POINT_FIELD,
  ];
  for (const path of everyField) {
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
  context: { signedIn: boolean; requiresShipping: boolean; delivery?: DeliveryMode },
  config: CheckoutConfig,
): string[] {
  const delivery = context.delivery ?? "none";
  const address = [
    COUNTRY_FIELD,
    ...config.addressFields
      .filter((field) => field.required)
      .map((field) => addressPath(field.name)),
  ];
  // The delivery method itself is not a text field: no method chosen is a block with a reason, not a blank to report.
  const deliveryFields = !context.requiresShipping
    ? []
    : delivery === "none" || delivery === "address"
      ? address
      : delivery === "pickup_point"
        ? [SHIPPING_CITY_FIELD, SHIPPING_POINT_FIELD]
        : [];
  return [
    ...(context.signedIn ? [] : ["email"]),
    "phone",
    "firstName",
    "lastName",
    ...deliveryFields,
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

/** The delivery the order is placed with: the chosen method, its kind, and the pickup point for a `pickup_point` method. */
export interface DeliverySelection {
  methodCode: string;
  kind: ShippingMethodKind;
  pickupPointRef: string;
}

export interface CheckoutBodyContext {
  signedIn: boolean;
  /** The cart's `requiresShipping`: the address is sent only then. */
  requiresShipping: boolean;
  locale: string;
  /**
   * The total the shopper sees: the server's `total` of the chosen shipping option, else the cart's total. Copied, never
   * computed.
   */
  expectedTotal: Money;
  /** The chosen delivery, `null` when the form has none (no shipping method in the shop, or a cart that ships nothing). */
  delivery?: DeliverySelection | null;
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
  const delivery = context.requiresShipping ? (context.delivery ?? null) : null;
  // The API refuses an address together with a pickup point (the point is the address) and takes none for a store pickup.
  if (context.requiresShipping && (delivery === null || delivery.kind === "address")) {
    const address: AddressInput = { countryCode: value(values, COUNTRY_FIELD) };
    for (const field of config.addressFields) {
      const text = value(values, addressPath(field.name));
      // A blank optional field is "not sent"; a sent blank is refused by the API as `empty`.
      if (text !== "" || field.required) address[field.name] = text;
    }
    body.shippingAddress = address;
  }
  if (delivery !== null) {
    body.shipping = {
      methodCode: delivery.methodCode,
      // A leftover ref from another method is never sent: the API refuses it for the other kinds.
      ...(delivery.kind === "pickup_point" ? { pickupPointRef: delivery.pickupPointRef } : {}),
    };
  }
  return body;
}

/** The allowed countries named in the page's locale (`Intl.DisplayNames`), in config order. */
export function countryOptions(
  config: CheckoutConfig,
  locale: string,
): { code: string; name: string }[] {
  return countryNames(config.allowedShippingCountries, locale);
}

/** Any list of country codes named in the page's locale; the delivery section passes the countries the methods serve. */
export function countryNames(
  codes: readonly string[],
  locale: string,
): { code: string; name: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return codes.map((code) => ({ code, name: names.of(code) ?? code }));
}

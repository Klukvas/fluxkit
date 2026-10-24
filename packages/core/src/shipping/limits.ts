import { CODE_PATTERN } from "../catalog/limits.js";

/*
 * Shipping codes, patterns and limits (ADR 0029 decisions 3, 5, 7 and 9). Constants only; the API and the provider
 * packages enforce them. Method and provider codes use the catalog `CODE_PATTERN` (a method code is never renamed).
 */

/** How a method reaches the shopper (ADR 0029 decision 7, `shipping_method.kind`). */
export const SHIPPING_METHOD_KINDS = Object.freeze([
  "address",
  "pickup_point",
  "store_pickup",
] as const);

export type ShippingMethodKind = (typeof SHIPPING_METHOD_KINDS)[number];

/** Who pays for the delivery of an order (`order_shipping.payer`): the shop's charge, or the recipient at the carrier. */
export const SHIPPING_PAYERS = Object.freeze(["shop_charge", "recipient_on_delivery"] as const);

export type ShippingPayer = (typeof SHIPPING_PAYERS)[number];

/** The shape of a shipping method code (`shipping_method.code`), the same as every other code. */
export const SHIPPING_METHOD_CODE_PATTERN = CODE_PATTERN;

/** The shape of a provider code (`"nova_poshta"`), the same as every other code. */
export const SHIPPING_PROVIDER_CODE_PATTERN = CODE_PATTERN;

/** ISO 3166-1 alpha-2 by pattern only (two upper-case letters), like `validateAddress`; no list of real countries. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * A carrier's reference that a client sends (a pickup point or a city ref; a Nova Poshta ref is a uuid): ASCII letters,
 * digits, `-` and `_`, 1 to 64 characters. Checked before a reference enters a carrier request (ADR 0029 decision 11).
 */
export const CARRIER_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A raw carrier status or error code (`shipment.carrier_status_code`, `ProviderResult.providerCodes`): short, no spaces,
 * so a carrier's message text (which can echo a name, a phone or the key) never fits.
 */
export const CARRIER_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;

export const SHIPPING_LIMITS = Object.freeze({
  /** Most tiers in one `tiers` pricing. */
  maxTiers: 20,
  /** Most countries in one method's `country_codes`. */
  maxCountriesPerMethod: 250,
  /** City search text of the lookup route, in code points (ADR 0029 decision 5). */
  lookupQueryMinLength: 2,
  lookupQueryMaxLength: 50,
  /** Largest page of the lookup routes. */
  maxCitiesPerPage: 50,
  maxPickupPointsPerPage: 200,
  /** One parcel per shipment in v1 (owner answer 9). */
  seatsPerShipment: 1,
  /** Most tracking numbers the API sends in one `track` call (one page of the tracking job). */
  maxTrackingNumbersPerCall: 100,
});

/** Time the API gives one provider call before it aborts it (ADR 0029 decision 9): the API decides, not the plugin. */
export const SHIPPING_PROVIDER_TIMEOUTS_MS = Object.freeze({
  lookup: 5_000,
  estimate: 5_000,
  waybill: 15_000,
});

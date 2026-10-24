import type { Address } from "../orders/contact.js";
import type { Money } from "../pricing/money.js";
import { CARRIER_CODE_PATTERN, SHIPPING_PROVIDER_CODE_PATTERN } from "./limits.js";
import type { CarrierReportedShipmentStatus, ShipmentPayer } from "./shipment-status.js";

/*
 * The shipping provider port (ADR 0029 decisions 8 and 9; the ADR 0018 / 0028 pattern). Types and constants only, so a
 * carrier package in `packages/providers/<code>` implements it without importing `apps/api`, and core never imports a
 * provider (dependency-cruiser `core-must-not-import-providers`). Internal until the first external plugin, then listed
 * in `docs/contracts/`. The Nova Poshta check (plan step 7a) may change it; that supersedes ADR 0029 decision 9 in part.
 *
 * Rules every provider follows:
 * - Money crosses the port in minor units with a currency; a carrier decimal is converted with `parseDecimalString`, and a
 *   value with more decimals than the currency allows is `rejected`, never rounded.
 * - A failure carries carrier CODES only (`providerFailure` checks them), never the carrier's message text: it can echo a
 *   name, a phone or the key.
 * - The API, not the provider, decides timeouts (it passes the `AbortSignal`, `SHIPPING_PROVIDER_TIMEOUTS_MS`), logging
 *   and caching. A provider honours the signal and never logs a request or response body.
 * - Plugins never influence an order total: `estimate` is informational only (ADR 0029 decision 1).
 */

/**
 * The abort signal the API passes to every provider call. Core has no DOM or Node type definitions, so this is the smallest
 * shape a standard `AbortSignal` already satisfies (like `MediaReadable`); the API passes a real `AbortSignal`, and a
 * provider may declare its parameter as `AbortSignal` (method parameters are compared bivariantly) to hand it to `fetch`.
 */
export interface ProviderAbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
  throwIfAborted(): void;
}

/** Metadata key on the provider class inside a provider's Nest module (`SetMetadata`); the API finds it by discovery. */
export const SHIPPING_PROVIDER_METADATA = "fluxkit:shipping-provider";

/** The `kind` a provider package declares: `"fluxkit": {"provider": "<code>", "kind": "shipping"}` in `package.json`. */
export const SHIPPING_PROVIDER_PACKAGE_KIND = "shipping";

export interface ShippingProviderMetadata {
  /** Equals the provider's `code`; the API refuses to start on a mismatch or a duplicate. */
  readonly code: string;
}

/** The value for `SetMetadata(SHIPPING_PROVIDER_METADATA, ...)`. A malformed code is a bug (RangeError). */
export function shippingProviderMetadata(code: string): ShippingProviderMetadata {
  if (typeof code !== "string" || !SHIPPING_PROVIDER_CODE_PATTERN.test(code)) {
    throw new RangeError(`Not a shipping provider code: ${String(code)}`);
  }
  return Object.freeze({ code });
}

export const SHIPPING_CAPABILITIES = Object.freeze([
  "pickupPoints",
  "estimate",
  "waybills",
  "cancelWaybill",
  "tracking",
  "labels",
] as const);

export type ShippingCapability = (typeof SHIPPING_CAPABILITIES)[number];

/** What the provider offers; a method it does not offer answers `not_supported`. */
export type ShippingCapabilities = Readonly<Record<ShippingCapability, boolean>>;

export const PROVIDER_FAILURE_REASONS = Object.freeze([
  /** Network failure, timeout, carrier outage or throttling: retry later. */
  "unavailable",
  /** The carrier refused the request (bad data, a rule of the carrier). */
  "rejected",
  /** The key is missing, wrong or expired. */
  "invalid_credentials",
  /** The provider does not offer this operation. */
  "not_supported",
] as const);

export type ProviderFailureReason = (typeof PROVIDER_FAILURE_REASONS)[number];

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: ProviderFailureReason;
      /** Raw carrier codes (`CARRIER_CODE_PATTERN`), never message text. May be empty. */
      readonly providerCodes: readonly string[];
    };

/** Most codes one failure carries. */
export const MAX_PROVIDER_CODES = 10;

export function providerOk<T>(value: T): ProviderResult<T> {
  return Object.freeze({ ok: true as const, value });
}

/**
 * A typed failure. Each code must match `CARRIER_CODE_PATTERN` (short, no spaces), so a carrier's message text cannot be
 * passed as a code; a bad reason, a bad code or more than `MAX_PROVIDER_CODES` codes is a bug in the provider (RangeError).
 */
export function providerFailure(
  reason: ProviderFailureReason,
  providerCodes: readonly string[] = [],
): ProviderResult<never> {
  if (!PROVIDER_FAILURE_REASONS.includes(reason)) {
    throw new RangeError(`Unknown provider failure reason: ${String(reason)}`);
  }
  if (!Array.isArray(providerCodes) || providerCodes.length > MAX_PROVIDER_CODES) {
    throw new RangeError(`A provider failure carries at most ${String(MAX_PROVIDER_CODES)} codes`);
  }
  for (const code of providerCodes) {
    if (typeof code !== "string" || !CARRIER_CODE_PATTERN.test(code)) {
      throw new RangeError("A provider failure code must be a short carrier code, not a message");
    }
  }
  return Object.freeze({
    ok: false as const,
    reason,
    providerCodes: Object.freeze([...providerCodes]),
  });
}

export const PICKUP_POINT_KINDS = Object.freeze(["branch", "locker"] as const);

export type PickupPointKind = (typeof PICKUP_POINT_KINDS)[number];

export interface CityResult {
  /** The carrier's city ref (`CARRIER_REFERENCE_PATTERN`). */
  readonly ref: string;
  /** As the carrier sends it, in the requested locale when it has one. */
  readonly name: string;
  readonly region: string | null;
}

export interface PickupPoint {
  /** The carrier's point ref (`CARRIER_REFERENCE_PATTERN`): what the checkout's `pickupPointRef` names. */
  readonly ref: string;
  /** The number the shopper knows the point by. */
  readonly number: string;
  readonly kind: PickupPointKind;
  readonly cityRef: string;
  readonly cityName: string;
  /**
   * ISO alpha-2 country of the point (`COUNTRY_CODE_PATTERN`): the destination country of a `pickup_point` order, checked
   * against the method's country list (ADR 0029 decision 4, "the carrier's country"). Added in plan step 6.
   */
  readonly countryCode: string;
  /** The carrier's description (address text), as sent. Public carrier data, no personal data. */
  readonly description: string;
  /** The heaviest parcel the point accepts, when the carrier says. */
  readonly maxWeightGrams: number | null;
}

/** Where a parcel goes: a carrier point, or an address (`validateAddress` output). */
export type ShippingDestination =
  | { readonly kind: "pickup_point"; readonly cityRef: string; readonly pickupPointRef: string }
  | { readonly kind: "address"; readonly address: Address };

export interface ParcelFacts {
  readonly weightGrams: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  /** `SHIPPING_LIMITS.seatsPerShipment` (1) in v1. */
  readonly seats: number;
}

export interface EstimateRequest {
  /** The method's `provider_service`, validated by the provider. */
  readonly service: string | null;
  readonly destination: { readonly kind: "city"; readonly cityRef: string } | ShippingDestination;
  /** The cart subtotal as the declared value. */
  readonly declaredValue: Money;
  /** `null`: the provider uses the default parcel of its settings. */
  readonly parcel: ParcelFacts | null;
  /** The stored `shipping_provider_setting.settings` (non-secret), validated by the provider. */
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface WaybillRequest {
  /** Our order number, sent to the carrier so `findWaybill` can find the waybill after a lost answer. */
  readonly clientReference: string;
  readonly service: string | null;
  readonly payer: ShipmentPayer;
  readonly declaredValue: Money;
  readonly parcel: ParcelFacts;
  /** Cargo description for the carrier (the admin's text or the settings' default). */
  readonly description: string;
  /** Required to deliver; goes to the carrier only, never into shipment rows, events or logs. */
  readonly recipient: {
    readonly firstName: string;
    readonly lastName: string;
    readonly phone: string;
  };
  readonly destination: ShippingDestination;
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface WaybillCreated {
  /** The carrier's internal id of the waybill. */
  readonly providerRef: string;
  /** The waybill number the recipient tracks. */
  readonly trackingNumber: string;
  /** The carrier's own price of this waybill: informational, never charged. */
  readonly carrierCost: Money | null;
  /** ISO date (`YYYY-MM-DD`) when the carrier says. */
  readonly estimatedDeliveryDate: string | null;
}

export interface TrackingUpdate {
  readonly trackingNumber: string;
  /** The provider's mapping of its code; `null` when the code has no normalized status (the shipment keeps its status). */
  readonly status: CarrierReportedShipmentStatus | null;
  /** The raw carrier status code (`CARRIER_CODE_PATTERN`). */
  readonly carrierStatusCode: string;
  readonly carrierStatusAt: Date | null;
}

export interface ShippingProviderPort {
  /** Matches `SHIPPING_PROVIDER_CODE_PATTERN`, e.g. `nova_poshta`. */
  readonly code: string;
  readonly capabilities: ShippingCapabilities;
  /** Directory lookups throw on failure (the API caches them and serves stale entries on errors). */
  searchCities(
    input: { readonly query: string; readonly locale: string; readonly limit: number },
    signal: ProviderAbortSignal,
  ): Promise<CityResult[]>;
  listPickupPoints(
    input: { readonly cityRef: string; readonly kinds: readonly PickupPointKind[] },
    signal: ProviderAbortSignal,
  ): Promise<PickupPoint[]>;
  /**
   * One point by its ref, `null` when the carrier has no such point. How the API resolves a checkout's `pickupPointRef`
   * when the point is not in its directory cache (another instance served the lookup, a restart, an evicted city): the
   * checkout names a point, not a city. Throws on failure, like the other lookups. Added in plan step 6.
   */
  findPickupPoint(
    input: { readonly ref: string },
    signal: ProviderAbortSignal,
  ): Promise<PickupPoint | null>;
  estimate(input: EstimateRequest, signal: ProviderAbortSignal): Promise<ProviderResult<Money>>;
  createWaybill(
    input: WaybillRequest,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated>>;
  /**
   * The waybill created with `clientReference`, or `null` when the carrier has none: how the API settles an `unknown`
   * shipment instead of a blind retry (ADR 0029 decision 10, `reconcile`). Added to the ADR's proposed shape in plan
   * step 2, because decision 10 needs it and decision 9 has no method for it.
   */
  findWaybill(
    input: { readonly clientReference: string; readonly createdOn: string },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated | null>>;
  cancelWaybill(
    input: { readonly providerRef: string },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<void>>;
  /** At most `SHIPPING_LIMITS.maxTrackingNumbersPerCall` numbers; `phones` (the recipients') widen the carrier's answer. */
  track(
    input: { readonly trackingNumbers: readonly string[]; readonly phones: readonly string[] },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<TrackingUpdate[]>>;
  /** The label bytes, streamed by our API; a carrier label URL never reaches a browser. */
  fetchLabel(
    input: { readonly providerRef: string; readonly format: "pdf" },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<{ bytes: Uint8Array; contentType: "application/pdf" }>>;
  checkConnection(signal: ProviderAbortSignal): Promise<ProviderResult<void>>;
}

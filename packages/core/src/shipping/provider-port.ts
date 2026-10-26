import type { Address } from "../orders/contact.js";
import type { Money } from "../pricing/money.js";
import { CARRIER_CODE_PATTERN, SHIPPING_PROVIDER_CODE_PATTERN } from "./limits.js";
import type { CarrierReportedShipmentStatus, ShipmentPayer } from "./shipment-status.js";

/*
 * The shipping provider port (ADR 0029 decisions 8 and 9; the ADR 0018 / 0028 pattern). Types and constants only, so a
 * carrier package in `packages/providers/<code>` implements it without importing `apps/api`, and core never imports a
 * provider (dependency-cruiser `core-must-not-import-providers`). Internal until the first external plugin, then listed
 * in `docs/contracts/`. Plan step 7b (the Nova Post plugin, `docs/plans/2026-10-25-nova-post-plugin.md`) added
 * `validateSettings`, the label's `trackingNumber` and the rule that `track` may ignore phones.
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

/**
 * The code a provider adds to a `createWaybill` failure when it can PROVE that no create request left (for example its
 * own authorization call failed first). The API then settles the shipment `failed` (a new create is allowed) instead of
 * `unknown`. A provider adds it only when that is certain: a wrong `not_sent` can lead to a second real shipment.
 * Added by the Nova Post review fixes (`docs/plans/2026-10-25-nova-post-plugin-review.md`, finding 8).
 */
export const PROVIDER_CODE_NOT_SENT = "not_sent";

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

/**
 * What `findWaybill` looks for (review M-2). The window is two INSTANTS, ISO 8601 in UTC (`Date.prototype.toISOString`,
 * e.g. `2026-10-24T21:58:00.000Z`), never a calendar date: the waybill, if it exists, was created at or after
 * `createdAfter` and at or before `createdBefore`. The API widens it on both sides (our shipment row's creation minus a
 * margin, the time of the lookup plus a margin), so clock skew and a slow save stay inside it. A provider whose carrier
 * files documents by its own calendar (the legacy Nova Poshta API used Kyiv dates; the Nova Post API gives UTC instants) maps the window to
 * EVERY local date it touches and filters by instant when the carrier gives one; it must never narrow the window to one
 * date (a waybill saved at 23:59 UTC carries the next Kyiv date). A `null` answer must mean "no such waybill in the
 * window", never "could not look": a failed or partial lookup is a failure result.
 */
export interface WaybillLookup {
  /** Our order number, as sent in `WaybillRequest.clientReference`. */
  readonly clientReference: string;
  /** ISO 8601 instant in UTC: the earliest creation time to consider. */
  readonly createdAfter: string;
  /** ISO 8601 instant in UTC, later than `createdAfter`: the latest creation time to consider. */
  readonly createdBefore: string;
}

/**
 * One problem `validateSettings` finds in a provider's settings. `path` is relative to the settings object (dot-separated
 * keys and array indexes, `""` for the object itself); `code` is a short code (`CARRIER_CODE_PATTERN`), never text.
 */
export interface ProviderSettingsIssue {
  readonly path: string;
  readonly code: string;
}

/** The shape of `ProviderSettingsIssue.path`: letters, digits, `_` and `.`, at most 200 characters. */
export const PROVIDER_SETTINGS_ISSUE_PATH_PATTERN = /^[A-Za-z0-9_.]{0,200}$/;

/** Most issues the API accepts from one `validateSettings` answer. */
export const MAX_PROVIDER_SETTINGS_ISSUES = 50;

/**
 * Whether `value` is a well-formed `validateSettings` answer: an array of at most `MAX_PROVIDER_SETTINGS_ISSUES` issues with
 * a path by `PROVIDER_SETTINGS_ISSUE_PATH_PATTERN` and a code by `CARRIER_CODE_PATTERN`. Anything else is a provider bug.
 */
export function isProviderSettingsIssueList(value: unknown): value is ProviderSettingsIssue[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_PROVIDER_SETTINGS_ISSUES &&
    value.every((entry: unknown) => {
      const issue = entry as Partial<ProviderSettingsIssue> | null;
      return (
        typeof issue === "object" &&
        issue !== null &&
        typeof issue.path === "string" &&
        PROVIDER_SETTINGS_ISSUE_PATH_PATTERN.test(issue.path) &&
        typeof issue.code === "string" &&
        CARRIER_CODE_PATTERN.test(issue.code)
      );
    })
  );
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
  /** Matches `SHIPPING_PROVIDER_CODE_PATTERN`, e.g. `nova_post`. */
  readonly code: string;
  readonly capabilities: ShippingCapabilities;
  /**
   * The problems of the shop's non-secret settings for this provider (`shipping_provider_setting.settings`), empty when it
   * accepts them. Synchronous and pure (no network). The admin settings route calls it after its own bounded check and
   * refuses the settings with `400 validation_failed` at `settings.<path>`; a provider still re-checks the settings when it
   * uses them (stored settings may predate it). Added in plan step 7b.
   */
  validateSettings(settings: Readonly<Record<string, unknown>>): readonly ProviderSettingsIssue[];
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
  /**
   * Never repeated by the API. An `unavailable` answer means a waybill may exist (the API's `unknown` + reconcile), unless
   * its codes contain `PROVIDER_CODE_NOT_SENT`: the provider proves no create request reached the carrier.
   */
  createWaybill(
    input: WaybillRequest,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated>>;
  /**
   * The waybill created with `clientReference` within the window, or `null` when the carrier has none: how the API settles
   * an `unknown` shipment instead of a blind retry (ADR 0029 decision 10, `reconcile`). Added to the ADR's proposed shape in
   * plan step 2, because decision 10 needs it and decision 9 has no method for it; the window replaced a UTC date in the
   * step 13 review fixes (M-2). See `WaybillLookup`.
   */
  findWaybill(
    input: WaybillLookup,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated | null>>;
  cancelWaybill(
    input: { readonly providerRef: string },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<void>>;
  /**
   * At most `SHIPPING_LIMITS.maxTrackingNumbersPerCall` numbers. `phones` (the recipients') widen the answer of a carrier
   * that uses them; a provider whose carrier tracks by number only ignores them (Nova Post, plan step 7b).
   */
  track(
    input: { readonly trackingNumbers: readonly string[]; readonly phones: readonly string[] },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<TrackingUpdate[]>>;
  /**
   * The label bytes, streamed by our API; a carrier label URL never reaches a browser. The input names the waybill both by
   * the carrier's id and by its number (a carrier may print by either; Nova Post prints by number, plan step 7b).
   */
  fetchLabel(
    input: {
      readonly providerRef: string;
      readonly trackingNumber: string;
      readonly format: "pdf";
    },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<{ bytes: Uint8Array; contentType: "application/pdf" }>>;
  checkConnection(signal: ProviderAbortSignal): Promise<ProviderResult<void>>;
}

import { Injectable, SetMetadata } from "@nestjs/common";
import {
  providerFailure,
  providerOk,
  SHIPPING_PROVIDER_METADATA,
  shippingProviderMetadata,
  type CarrierReportedShipmentStatus,
  type CityResult,
  type EstimateRequest,
  type Money,
  type PickupPoint,
  type PickupPointKind,
  type ProviderAbortSignal,
  type ProviderFailureReason,
  type ProviderResult,
  type ShippingCapabilities,
  type ShippingProviderPort,
  type TrackingUpdate,
  type WaybillCreated,
  type WaybillLookup,
  type WaybillRequest,
} from "@fluxkit/core";

/*
 * TEST-ONLY. A deterministic, in-memory shipping provider: no network, no randomness, no environment variables; its only
 * clock is the replaceable `now` hook, which dates the waybills it creates (so `findWaybill` can honour its window).
 * It exists so the shipping module, the provider loader and the e2e suites have a provider that is always available and
 * can be told to fail. It must never be enabled in a real shop: its cities, points, prices and waybills are made up.
 */

export const FAKE_PROVIDER_CODE = "fake";

/** The operations a test can make fail with `failNext`. */
export const FAKE_OPERATIONS = Object.freeze([
  "searchCities",
  "listPickupPoints",
  "findPickupPoint",
  "estimate",
  "createWaybill",
  "findWaybill",
  "cancelWaybill",
  "track",
  "fetchLabel",
  "checkConnection",
] as const);

export type FakeOperation = (typeof FAKE_OPERATIONS)[number];

export interface FakeFailure {
  /** Result-returning operations answer `providerFailure(reason, providerCodes)`. Default `unavailable`. */
  readonly reason?: ProviderFailureReason;
  /** Raw carrier codes of the failure; default none. */
  readonly providerCodes?: readonly string[];
  /** How many calls fail. Default 1. */
  readonly times?: number;
  /**
   * `createWaybill` only: the waybill IS created (and `findWaybill` finds it), but the answer is lost (the call fails with the
   * given reason). This is how a test reproduces an `unknown` shipment that `reconcile` has to settle.
   */
  readonly afterEffect?: boolean;
  /** The call never answers until its abort signal fires, then rejects (reproduces a timeout). */
  readonly hang?: boolean;
}

interface PendingFailure extends FakeFailure {
  remaining: number;
}

interface StoredWaybill {
  readonly created: WaybillCreated;
  readonly clientReference: string;
  readonly createdAt: Date;
  status: CarrierReportedShipmentStatus;
  carrierStatusCode: string;
  cancelled: boolean;
}

const CAPABILITIES: ShippingCapabilities = Object.freeze({
  pickupPoints: true,
  estimate: true,
  waybills: true,
  cancelWaybill: true,
  tracking: true,
  labels: true,
});

interface FakeCity {
  readonly ref: string;
  readonly nameUk: string;
  readonly nameEn: string;
  readonly regionUk: string;
  readonly regionEn: string;
}

const CITIES: readonly FakeCity[] = Object.freeze([
  { ref: "fake-city-kyiv", nameUk: "Київ", nameEn: "Kyiv", regionUk: "Київська", regionEn: "Kyiv" },
  {
    ref: "fake-city-lviv",
    nameUk: "Львів",
    nameEn: "Lviv",
    regionUk: "Львівська",
    regionEn: "Lviv",
  },
  {
    ref: "fake-city-odesa",
    nameUk: "Одеса",
    nameEn: "Odesa",
    regionUk: "Одеська",
    regionEn: "Odesa",
  },
]);

/** Two points per city: branch 1 and locker 2. Refs are `<city ref>-point-<number>`. */
function pointsOf(city: FakeCity): PickupPoint[] {
  const kinds: PickupPointKind[] = ["branch", "locker"];
  return kinds.map((kind, index) => ({
    ref: `${city.ref}-point-${String(index + 1)}`,
    number: String(index + 1),
    kind,
    cityRef: city.ref,
    cityName: city.nameEn,
    countryCode: "UA",
    description: `Fake ${kind} ${String(index + 1)}, ${city.nameEn}`,
    maxWeightGrams: kind === "branch" ? 30_000 : 20_000,
  }));
}

/** The fixed price the fake quotes for any destination, in the currency of the declared value. */
export const FAKE_ESTIMATE_MINOR_UNITS = 7_500;

@Injectable()
@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata(FAKE_PROVIDER_CODE))
export class FakeShippingProvider implements ShippingProviderPort {
  readonly code = FAKE_PROVIDER_CODE;
  readonly capabilities = CAPABILITIES;

  private readonly failures = new Map<FakeOperation, PendingFailure>();
  private readonly waybills = new Map<string, StoredWaybill>();
  private readonly byClientReference = new Map<string, StoredWaybill>();
  private sequence = 0;

  /** Test hook: the fake carrier's clock, which dates the waybills it creates. Not part of ShippingProviderPort. */
  now: () => Date = () => new Date();

  /*
   * Test hooks. Not part of ShippingProviderPort; a test reaches them by `app.get(FakeShippingProvider)` or a cast of the
   * registry's answer. They act inside one process: a separate API process cannot be told to fail.
   */

  /** Makes the next `times` (default 1) calls of `operation` fail as described by `failure`. Replaces an earlier plan. */
  failNext(operation: FakeOperation, failure: FakeFailure = {}): void {
    if (!FAKE_OPERATIONS.includes(operation)) {
      throw new RangeError(`Unknown fake operation: ${String(operation)}`);
    }
    const times = failure.times ?? 1;
    if (!Number.isInteger(times) || times < 1) {
      throw new RangeError("failNext: times must be a positive integer");
    }
    this.failures.set(operation, { ...failure, remaining: times });
  }

  /** Sets what the next `track` answers for a waybill (default after `createWaybill`: `created`). */
  setTrackingStatus(
    trackingNumber: string,
    status: CarrierReportedShipmentStatus,
    carrierStatusCode: string,
  ): void {
    const waybill = this.waybillByTrackingNumber(trackingNumber);
    if (waybill === undefined) {
      throw new RangeError(`Unknown fake waybill: ${trackingNumber}`);
    }
    waybill.status = status;
    waybill.carrierStatusCode = carrierStatusCode;
  }

  /** Forgets every waybill and every planned failure; the waybill counter restarts, so numbers repeat after a reset. */
  reset(): void {
    this.failures.clear();
    this.waybills.clear();
    this.byClientReference.clear();
    this.sequence = 0;
    this.now = () => new Date();
  }

  /** How many waybills exist (cancelled ones included): lets a test check that a failed call created none. */
  waybillCount(): number {
    return this.waybills.size;
  }

  searchCities(
    input: { readonly query: string; readonly locale: string; readonly limit: number },
    signal: ProviderAbortSignal,
  ): Promise<CityResult[]> {
    return this.run("searchCities", signal, () => {
      const needle = input.query.trim().toLowerCase();
      const uk = input.locale.toLowerCase().startsWith("uk");
      return CITIES.filter(
        (city) =>
          needle === "" ||
          city.nameUk.toLowerCase().includes(needle) ||
          city.nameEn.toLowerCase().includes(needle),
      )
        .slice(0, Math.max(0, input.limit))
        .map((city) => ({
          ref: city.ref,
          name: uk ? city.nameUk : city.nameEn,
          region: uk ? city.regionUk : city.regionEn,
        }));
    });
  }

  listPickupPoints(
    input: { readonly cityRef: string; readonly kinds: readonly PickupPointKind[] },
    signal: ProviderAbortSignal,
  ): Promise<PickupPoint[]> {
    return this.run("listPickupPoints", signal, () => {
      const city = CITIES.find((candidate) => candidate.ref === input.cityRef);
      return city === undefined
        ? []
        : pointsOf(city).filter((point) => input.kinds.includes(point.kind));
    });
  }

  findPickupPoint(
    input: { readonly ref: string },
    signal: ProviderAbortSignal,
  ): Promise<PickupPoint | null> {
    return this.run("findPickupPoint", signal, () => {
      for (const city of CITIES) {
        const point = pointsOf(city).find((candidate) => candidate.ref === input.ref);
        if (point !== undefined) {
          return point;
        }
      }
      return null;
    });
  }

  estimate(input: EstimateRequest, signal: ProviderAbortSignal): Promise<ProviderResult<Money>> {
    return this.runResult("estimate", signal, () => {
      const cityRef = this.cityRefOf(input.destination);
      if (cityRef !== null && !CITIES.some((city) => city.ref === cityRef)) {
        return providerFailure("rejected", ["UNKNOWN_CITY"]);
      }
      return providerOk({
        amount: FAKE_ESTIMATE_MINOR_UNITS,
        currency: input.declaredValue.currency,
      });
    });
  }

  createWaybill(
    input: WaybillRequest,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated>> {
    return this.runResult("createWaybill", signal, (afterEffect) => {
      const existing = this.byClientReference.get(input.clientReference);
      if (existing !== undefined) {
        return providerFailure("rejected", ["DUPLICATE_REFERENCE"]);
      }
      if (
        input.destination.kind === "pickup_point" &&
        !this.knownPointRef(input.destination.pickupPointRef)
      ) {
        return providerFailure("rejected", ["UNKNOWN_POINT"]);
      }
      this.sequence += 1;
      const number = String(this.sequence).padStart(6, "0");
      const created: WaybillCreated = {
        providerRef: `fake-waybill-${number}`,
        trackingNumber: `FAKE${number}`,
        carrierCost: { amount: FAKE_ESTIMATE_MINOR_UNITS, currency: input.declaredValue.currency },
        estimatedDeliveryDate: null,
      };
      const stored: StoredWaybill = {
        created,
        clientReference: input.clientReference,
        createdAt: this.now(),
        status: "created",
        carrierStatusCode: "FAKE_CREATED",
        cancelled: false,
      };
      this.waybills.set(created.providerRef, stored);
      this.byClientReference.set(input.clientReference, stored);
      // The effect is kept; only the answer is lost, so `findWaybill` can settle the shipment.
      return afterEffect ? providerFailure("unavailable") : providerOk(created);
    });
  }

  /** By client reference, within the window by instant (review M-2); a window that is not two ordered instants is `rejected`. */
  findWaybill(
    input: WaybillLookup,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated | null>> {
    return this.runResult("findWaybill", signal, () => {
      const after = Date.parse(input.createdAfter);
      const before = Date.parse(input.createdBefore);
      if (!(after < before)) {
        return providerFailure("rejected", ["INVALID_WINDOW"]);
      }
      const found = this.byClientReference.get(input.clientReference);
      if (found === undefined || found.cancelled) {
        return providerOk(null);
      }
      const at = found.createdAt.getTime();
      return providerOk(at >= after && at <= before ? found.created : null);
    });
  }

  cancelWaybill(
    input: { readonly providerRef: string },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<void>> {
    return this.runResult("cancelWaybill", signal, () => {
      const waybill = this.waybills.get(input.providerRef);
      if (waybill === undefined) {
        return providerFailure("rejected", ["UNKNOWN_WAYBILL"]);
      }
      if (waybill.status !== "created") {
        return providerFailure("rejected", ["NOT_CANCELLABLE"]);
      }
      waybill.cancelled = true;
      waybill.status = "cancelled";
      waybill.carrierStatusCode = "FAKE_CANCELLED";
      return providerOk(undefined);
    });
  }

  track(
    input: { readonly trackingNumbers: readonly string[]; readonly phones: readonly string[] },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<TrackingUpdate[]>> {
    return this.runResult("track", signal, () => {
      const updates: TrackingUpdate[] = [];
      for (const trackingNumber of input.trackingNumbers) {
        const waybill = this.waybillByTrackingNumber(trackingNumber);
        if (waybill !== undefined) {
          updates.push({
            trackingNumber,
            status: waybill.status,
            carrierStatusCode: waybill.carrierStatusCode,
            carrierStatusAt: null,
          });
        }
      }
      return providerOk(updates);
    });
  }

  fetchLabel(
    input: { readonly providerRef: string; readonly format: "pdf" },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<{ bytes: Uint8Array; contentType: "application/pdf" }>> {
    return this.runResult("fetchLabel", signal, () => {
      if (!this.waybills.has(input.providerRef)) {
        return providerFailure("rejected", ["UNKNOWN_WAYBILL"]);
      }
      return providerOk({
        bytes: new TextEncoder().encode(fakePdf(input.providerRef)),
        contentType: "application/pdf" as const,
      });
    });
  }

  checkConnection(signal: ProviderAbortSignal): Promise<ProviderResult<void>> {
    return this.runResult("checkConnection", signal, () => providerOk(undefined));
  }

  private waybillByTrackingNumber(trackingNumber: string): StoredWaybill | undefined {
    for (const waybill of this.waybills.values()) {
      if (waybill.created.trackingNumber === trackingNumber) {
        return waybill;
      }
    }
    return undefined;
  }

  private cityRefOf(destination: EstimateRequest["destination"]): string | null {
    return destination.kind === "address" ? null : destination.cityRef;
  }

  private knownPointRef(pickupPointRef: string): boolean {
    return CITIES.some((city) => pointsOf(city).some((point) => point.ref === pickupPointRef));
  }

  /** Takes the planned failure of `operation` when there is one (counting it down), `undefined` otherwise. */
  private takeFailure(operation: FakeOperation): FakeFailure | undefined {
    const planned = this.failures.get(operation);
    if (planned === undefined) {
      return undefined;
    }
    planned.remaining -= 1;
    if (planned.remaining <= 0) {
      this.failures.delete(operation);
    }
    return planned;
  }

  /** A directory lookup: a planned failure throws, as the port says lookups do. */
  private async run<T>(
    operation: FakeOperation,
    signal: ProviderAbortSignal,
    work: () => T,
  ): Promise<T> {
    signal.throwIfAborted();
    const failure = this.takeFailure(operation);
    if (failure !== undefined) {
      if (failure.hang === true) {
        return hangUntilAborted(signal);
      }
      throw new Error(`fake provider: ${operation} failed on request`);
    }
    return work();
  }

  /** A result-returning operation: a planned failure is a typed `ProviderResult`. */
  private async runResult<T>(
    operation: FakeOperation,
    signal: ProviderAbortSignal,
    work: (afterEffect: boolean) => ProviderResult<T>,
  ): Promise<ProviderResult<T>> {
    signal.throwIfAborted();
    const failure = this.takeFailure(operation);
    if (failure === undefined) {
      return work(false);
    }
    if (failure.hang === true) {
      return hangUntilAborted(signal);
    }
    if (failure.afterEffect === true && operation === "createWaybill") {
      work(true);
    }
    return providerFailure(failure.reason ?? "unavailable", failure.providerCodes ?? []);
  }
}

function hangUntilAborted(signal: ProviderAbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** A tiny, syntactically plain PDF-looking document: enough for a label route to stream and a test to sniff. */
function fakePdf(providerRef: string): string {
  return `%PDF-1.4\n% Fake label for ${providerRef} (test-only)\n%%EOF\n`;
}

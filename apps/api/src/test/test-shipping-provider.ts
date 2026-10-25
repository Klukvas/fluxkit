import { randomBytes } from "node:crypto";
import { Injectable, Module, SetMetadata, type Type } from "@nestjs/common";
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
  type ProviderSettingsIssue,
  type ShippingCapabilities,
  type ShippingProviderPort,
  type TrackingUpdate,
  type WaybillCreated,
  type WaybillLookup,
  type WaybillRequest,
} from "@fluxkit/core";
import type { LoadedShippingProvider } from "../shipping/registry/index.js";

/** Code of the in-repo test provider. Specs mount it with `startApp({ extraShippingProviders: testShippingProviders() })`. */
export const TEST_PROVIDER_CODE = "fake";

/** Code of the second test provider (`testShippingProviders({ second: true })`): two carriers in one shop. */
export const SECOND_TEST_PROVIDER_CODE = "fake_two";

export interface TestProviderFailure {
  reason?: ProviderFailureReason;
  providerCodes?: readonly string[];
  /** The call never answers until its abort signal fires, then rejects (a timeout). */
  hang?: boolean;
}

/** The provider calls the shipping store and checkout make; a spec plans failures and counts calls per operation. */
export const TEST_LOOKUP_OPERATIONS = [
  "searchCities",
  "listPickupPoints",
  "findPickupPoint",
  "estimate",
] as const;

export type TestLookupOperation = (typeof TEST_LOOKUP_OPERATIONS)[number];

/** The waybill calls the shipment routes and the tracking job make (plan step 8). */
export const TEST_WAYBILL_OPERATIONS = [
  "createWaybill",
  "findWaybill",
  "cancelWaybill",
  "track",
  "fetchLabel",
] as const;

export type TestWaybillOperation = (typeof TEST_WAYBILL_OPERATIONS)[number];

export type TestOperation = TestLookupOperation | TestWaybillOperation;

export interface TestLookupFailure {
  /** How many calls fail. Default 1. */
  times?: number;
  /** The call never answers until its abort signal fires, then rejects (a timeout). */
  hang?: boolean;
  /**
   * The text of the thrown error (lookups) or nothing (`estimate` answers a typed failure). A spec puts personal data and a
   * fake key here to prove the API never logs or returns a provider's message.
   */
  message?: string;
  /** `estimate` only: the typed reason (default `unavailable`). */
  reason?: ProviderFailureReason;
}

export interface TestWaybillFailure {
  /** How many calls fail. Default 1. */
  times?: number;
  /** Typed failure (default `unavailable`) with these carrier codes. */
  reason?: ProviderFailureReason;
  providerCodes?: readonly string[];
  /** The call never answers until its abort signal fires, then rejects (a timeout: a lost answer). */
  hang?: boolean;
  /** The call throws an error with this text (a provider bug or a network error carrying personal data). */
  message?: string;
  /**
   * `createWaybill` only: the carrier DOES create the waybill (so `findWaybill` finds it), then the answer is lost the way
   * `hang`, `message` or `reason` say. How a spec reproduces an `unknown` shipment that `reconcile` settles.
   */
  afterEffect?: boolean;
  /** The call answers `{ok: true, value: answer}` with this value as is (an answer that breaks the port). */
  answer?: unknown;
}

/** The estimate the test provider quotes for any destination, in the currency of the declared value. */
export const TEST_ESTIMATE_MINOR_UNITS = 6_000;

/** What the test carrier charges the shop for a waybill (informational, `carrier_cost_amount`). */
export const TEST_WAYBILL_COST_MINOR_UNITS = 7_500;

export const TEST_CITIES: readonly CityResult[] = Object.freeze([
  Object.freeze({ ref: "test-city-kyiv", name: "Київ", region: "Київська" }),
  Object.freeze({ ref: "test-city-lviv", name: "Львів", region: "Львівська" }),
]);

function point(
  cityRef: string,
  cityName: string,
  number: string,
  kind: PickupPointKind,
  description: string,
): PickupPoint {
  return Object.freeze({
    ref: `${cityRef}-point-${number}`,
    number,
    kind,
    cityRef,
    cityName,
    countryCode: "UA",
    description,
    maxWeightGrams: kind === "branch" ? 30_000 : 20_000,
  });
}

export const TEST_POINTS: readonly PickupPoint[] = Object.freeze([
  point("test-city-kyiv", "Київ", "1", "branch", "Відділення №1, вул. Тестова, 1"),
  point("test-city-kyiv", "Київ", "2", "locker", "Поштомат №2, вул. Тестова, 2"),
  point("test-city-lviv", "Львів", "1", "branch", "Відділення №1, пл. Тестова, 3"),
]);

const ALL_CAPABILITIES: ShippingCapabilities = Object.freeze({
  pickupPoints: true,
  estimate: true,
  waybills: true,
  cancelWaybill: true,
  tracking: true,
  labels: true,
});

/**
 * One sequence for every test carrier of the process, behind a prefix of this process: several apps of one spec (one
 * per role) and earlier spec files share the database, where a waybill number is unique per provider.
 */
let waybillSequence = 0;
const WAYBILL_RUN = randomBytes(3).toString("hex").toUpperCase();

/** A waybill the test carrier holds: what `findWaybill`, `cancelWaybill`, `track` and `fetchLabel` work on. */
export interface TestWaybill {
  readonly created: WaybillCreated;
  readonly clientReference: string;
  /** When the carrier saved it (`now()` at the create): what `findWaybill`'s window is checked against. */
  readonly createdAt: Date;
  status: CarrierReportedShipmentStatus;
  carrierStatusCode: string;
  carrierStatusAt: Date | null;
  /** `track` leaves this waybill out of its answer (the carrier does not know the number any more). */
  untracked: boolean;
}

interface PlannedFailure<F> {
  failure: F;
  remaining: number;
}

/** A tiny PDF-looking document: enough for the label route to stream and a spec to sniff. */
export function testLabelBytes(providerRef: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4\n% Test label for ${providerRef}\n%%EOF\n`);
}

/**
 * TEST ONLY. A small provider that lives in apps/api, so core and API specs depend on no package under packages/providers
 * (the CI mode providers-deleted removes them). It serves a fixed directory (two cities, three points, all in `UA`) and a
 * fixed estimate, keeps the waybills it created in memory (numbers `TEST<run><sequence>`, refs `test-waybill-<run><sequence>`), counts every
 * call, remembers the last waybill request (so a spec can see what reached the carrier), and lets a spec plan failures
 * (`failNext` for `checkConnection`, `failLookup` for the store calls, `failWaybill` for the waybill calls) or hold calls
 * until it releases them (`hold`, for request coalescing and for "the carrier is slow").
 */
@Injectable()
@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata(TEST_PROVIDER_CODE))
export class TestShippingProvider implements ShippingProviderPort {
  readonly code: string = TEST_PROVIDER_CODE;
  /** Every capability by default; a spec may replace it (the registry checks it only at startup). */
  capabilities: ShippingCapabilities = ALL_CAPABILITIES;
  /** The directory the lookups answer from; a spec may replace it. */
  cities: readonly CityResult[] = TEST_CITIES;
  points: readonly PickupPoint[] = TEST_POINTS;
  estimateAmount = TEST_ESTIMATE_MINOR_UNITS;
  /** The label `fetchLabel` answers (`null`: `testLabelBytes(providerRef)`), and its declared type. */
  labelBytes: Uint8Array | null = null;
  labelContentType = "application/pdf";
  /**
   * What `validateSettings` answers (default: every object is accepted). A function so a spec can refuse by content, or
   * answer something that breaks the port (a provider bug) or throw.
   */
  settingsIssues: (settings: Readonly<Record<string, unknown>>) => unknown = () => [];
  /** The arguments of the label calls, in call order. */
  readonly labelRequests: { providerRef: string; trackingNumber: string }[] = [];
  readonly calls: Record<TestOperation, number> = TestShippingProvider.zeroCalls();
  /** The arguments of the waybill calls, in call order. */
  readonly waybillRequests: WaybillRequest[] = [];
  readonly findRequests: WaybillLookup[] = [];
  /** The carrier's clock: dates the waybills it creates (a spec may replace it, e.g. with the API's fake clock). */
  now: () => Date = () => new Date();
  readonly trackRequests: { trackingNumbers: readonly string[]; phones: readonly string[] }[] = [];
  readonly waybills = new Map<string, TestWaybill>();
  private pending: (TestProviderFailure & { remaining: number }) | undefined;
  private readonly lookupFailures = new Map<TestLookupOperation, PlannedLookupFailure>();
  private readonly waybillFailures = new Map<
    TestWaybillOperation,
    PlannedFailure<TestWaybillFailure>
  >();
  private readonly held = new Map<TestOperation, Promise<void>>();

  private static zeroCalls(): Record<TestOperation, number> {
    const calls = {} as Record<TestOperation, number>;
    for (const operation of [...TEST_LOOKUP_OPERATIONS, ...TEST_WAYBILL_OPERATIONS]) {
      calls[operation] = 0;
    }
    return calls;
  }

  failNext(failure: TestProviderFailure = {}): void {
    this.pending = { ...failure, remaining: 1 };
  }

  /** The next `times` calls of `operation` fail as described. Replaces an earlier plan for that operation. */
  failLookup(operation: TestLookupOperation, failure: TestLookupFailure = {}): void {
    this.lookupFailures.set(operation, { ...failure, remaining: failure.times ?? 1 });
  }

  /** The next `times` calls of a waybill operation fail as described. Replaces an earlier plan for that operation. */
  failWaybill(operation: TestWaybillOperation, failure: TestWaybillFailure = {}): void {
    this.waybillFailures.set(operation, { failure, remaining: failure.times ?? 1 });
  }

  /** Every call of `operation` waits until the returned function is called (then they all go on). */
  hold(operation: TestOperation): () => void {
    let release: () => void = () => undefined;
    this.held.set(
      operation,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      this.held.delete(operation);
      release();
    };
  }

  /** What `track` answers next for the waybill of `trackingNumber`. */
  setTracking(
    trackingNumber: string,
    update: {
      status: CarrierReportedShipmentStatus;
      carrierStatusCode: string;
      carrierStatusAt?: Date | null;
    },
  ): void {
    const waybill = this.byTrackingNumber(trackingNumber);
    if (waybill === undefined) {
      throw new RangeError(`Unknown test waybill: ${trackingNumber}`);
    }
    waybill.status = update.status;
    waybill.carrierStatusCode = update.carrierStatusCode;
    waybill.carrierStatusAt = update.carrierStatusAt ?? null;
  }

  /** Forgets planned failures, holds, counts, waybills and directory changes. */
  reset(): void {
    this.pending = undefined;
    this.lookupFailures.clear();
    this.waybillFailures.clear();
    this.held.clear();
    this.cities = TEST_CITIES;
    this.points = TEST_POINTS;
    this.estimateAmount = TEST_ESTIMATE_MINOR_UNITS;
    this.capabilities = ALL_CAPABILITIES;
    this.labelBytes = null;
    this.labelContentType = "application/pdf";
    this.settingsIssues = () => [];
    this.labelRequests.length = 0;
    this.waybills.clear();
    this.now = () => new Date();
    this.waybillRequests.length = 0;
    this.findRequests.length = 0;
    this.trackRequests.length = 0;
    Object.assign(this.calls, TestShippingProvider.zeroCalls());
  }

  validateSettings(settings: Readonly<Record<string, unknown>>): readonly ProviderSettingsIssue[] {
    return this.settingsIssues(settings) as readonly ProviderSettingsIssue[];
  }

  searchCities(
    input: { readonly query: string; readonly locale: string; readonly limit: number },
    signal: ProviderAbortSignal,
  ): Promise<CityResult[]> {
    return this.lookup("searchCities", signal, () => {
      const needle = input.query.toLowerCase();
      return this.cities
        .filter((city) => city.name.toLowerCase().includes(needle))
        .slice(0, input.limit);
    });
  }

  listPickupPoints(
    input: { readonly cityRef: string; readonly kinds: readonly PickupPointKind[] },
    signal: ProviderAbortSignal,
  ): Promise<PickupPoint[]> {
    return this.lookup("listPickupPoints", signal, () =>
      this.points.filter(
        (entry) => entry.cityRef === input.cityRef && input.kinds.includes(entry.kind),
      ),
    );
  }

  findPickupPoint(
    input: { readonly ref: string },
    signal: ProviderAbortSignal,
  ): Promise<PickupPoint | null> {
    return this.lookup(
      "findPickupPoint",
      signal,
      () => this.points.find((entry) => entry.ref === input.ref) ?? null,
    );
  }

  async estimate(
    input: EstimateRequest,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<Money>> {
    const failure = await this.begin("estimate", signal);
    if (failure !== undefined) {
      if (failure.message !== undefined) {
        throw new Error(failure.message);
      }
      return providerFailure(failure.reason ?? "unavailable", []);
    }
    return providerOk({ amount: this.estimateAmount, currency: input.declaredValue.currency });
  }

  createWaybill(
    input: WaybillRequest,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated>> {
    this.waybillRequests.push(input);
    return this.waybillCall("createWaybill", signal, () => {
      waybillSequence += 1;
      const number = `${WAYBILL_RUN}${String(waybillSequence).padStart(6, "0")}`;
      const created: WaybillCreated = Object.freeze({
        providerRef: `test-waybill-${number}`,
        trackingNumber: `TEST${number}`,
        carrierCost: {
          amount: TEST_WAYBILL_COST_MINOR_UNITS,
          currency: input.declaredValue.currency,
        },
        estimatedDeliveryDate: null,
      });
      this.waybills.set(created.providerRef, {
        created,
        clientReference: input.clientReference,
        createdAt: this.now(),
        status: "created",
        carrierStatusCode: "TEST_CREATED",
        carrierStatusAt: null,
        untracked: false,
      });
      return created;
    });
  }

  /** Honours the window by instant (review M-2): a waybill saved outside `[createdAfter, createdBefore]` is not found. */
  findWaybill(
    input: WaybillLookup,
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<WaybillCreated | null>> {
    this.findRequests.push({ ...input });
    const after = Date.parse(input.createdAfter);
    const before = Date.parse(input.createdBefore);
    if (!(after < before)) {
      throw new RangeError("findWaybill: the window must be two ISO instants, after < before");
    }
    return this.waybillCall("findWaybill", signal, () => {
      for (const waybill of this.waybills.values()) {
        const at = waybill.createdAt.getTime();
        if (
          waybill.clientReference === input.clientReference &&
          waybill.status !== "cancelled" &&
          at >= after &&
          at <= before
        ) {
          return waybill.created;
        }
      }
      return null;
    });
  }

  cancelWaybill(
    input: { readonly providerRef: string },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<void>> {
    return this.waybillCall("cancelWaybill", signal, () => {
      const waybill = this.waybills.get(input.providerRef);
      if (waybill === undefined) {
        return providerFailure("rejected", ["UNKNOWN_WAYBILL"]);
      }
      if (waybill.status !== "created") {
        return providerFailure("rejected", ["NOT_CANCELLABLE"]);
      }
      waybill.status = "cancelled";
      waybill.carrierStatusCode = "TEST_CANCELLED";
      return undefined;
    });
  }

  track(
    input: { readonly trackingNumbers: readonly string[]; readonly phones: readonly string[] },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<TrackingUpdate[]>> {
    this.trackRequests.push({
      trackingNumbers: [...input.trackingNumbers],
      phones: [...input.phones],
    });
    return this.waybillCall("track", signal, () => {
      const updates: TrackingUpdate[] = [];
      for (const trackingNumber of input.trackingNumbers) {
        const waybill = this.byTrackingNumber(trackingNumber);
        if (waybill !== undefined && !waybill.untracked) {
          updates.push({
            trackingNumber,
            status: waybill.status,
            carrierStatusCode: waybill.carrierStatusCode,
            carrierStatusAt: waybill.carrierStatusAt,
          });
        }
      }
      return updates;
    });
  }

  /** A label for a known waybill whose number matches its ref (the port names the waybill both ways). */
  fetchLabel(
    input: {
      readonly providerRef: string;
      readonly trackingNumber: string;
      readonly format: "pdf";
    },
    signal: ProviderAbortSignal,
  ): Promise<ProviderResult<{ bytes: Uint8Array; contentType: "application/pdf" }>> {
    this.labelRequests.push({
      providerRef: input.providerRef,
      trackingNumber: input.trackingNumber,
    });
    return this.waybillCall("fetchLabel", signal, () => {
      if (this.waybills.get(input.providerRef)?.created.trackingNumber !== input.trackingNumber) {
        return providerFailure("rejected", ["UNKNOWN_WAYBILL"]);
      }
      return {
        bytes: this.labelBytes ?? testLabelBytes(input.providerRef),
        contentType: this.labelContentType as "application/pdf",
      };
    });
  }

  checkConnection(signal: ProviderAbortSignal): Promise<ProviderResult<void>> {
    const failure = this.pending;
    this.pending = undefined;
    if (failure === undefined) {
      return Promise.resolve(providerOk(undefined));
    }
    if (failure.hang === true) {
      return hangUntilAborted(signal);
    }
    return Promise.resolve(
      providerFailure(failure.reason ?? "unavailable", failure.providerCodes ?? []),
    );
  }

  private byTrackingNumber(trackingNumber: string): TestWaybill | undefined {
    for (const waybill of this.waybills.values()) {
      if (waybill.created.trackingNumber === trackingNumber) {
        return waybill;
      }
    }
    return undefined;
  }

  /**
   * A waybill call: counts it, waits while it is held, then either does the work (a value is wrapped in `providerOk`, a
   * `ProviderResult` the work returns is passed on) or the planned failure. `afterEffect` does the work first.
   */
  private async waybillCall<T>(
    operation: TestWaybillOperation,
    signal: ProviderAbortSignal,
    work: () => T | ProviderResult<T>,
  ): Promise<ProviderResult<T>> {
    this.calls[operation] += 1;
    signal.throwIfAborted();
    const held = this.held.get(operation);
    if (held !== undefined) {
      await held;
    }
    const planned = this.waybillFailures.get(operation);
    if (planned === undefined) {
      return asResult(work());
    }
    planned.remaining -= 1;
    if (planned.remaining <= 0) {
      this.waybillFailures.delete(operation);
    }
    const { failure } = planned;
    if (failure.afterEffect === true) {
      work();
    }
    if (failure.hang === true) {
      return hangUntilAborted(signal);
    }
    if (failure.message !== undefined) {
      throw new Error(failure.message);
    }
    if ("answer" in failure) {
      return { ok: true, value: failure.answer as T };
    }
    return providerFailure(failure.reason ?? "unavailable", failure.providerCodes ?? []);
  }

  private async lookup<T>(
    operation: TestLookupOperation,
    signal: ProviderAbortSignal,
    work: () => T,
  ): Promise<T> {
    const failure = await this.begin(operation, signal);
    if (failure !== undefined) {
      throw new Error(failure.message ?? `test provider: ${operation} failed on request`);
    }
    return work();
  }

  /** Counts the call, waits while the operation is held, then returns the planned failure (a hang never returns). */
  private async begin(
    operation: TestLookupOperation,
    signal: ProviderAbortSignal,
  ): Promise<TestLookupFailure | undefined> {
    this.calls[operation] += 1;
    signal.throwIfAborted();
    const held = this.held.get(operation);
    if (held !== undefined) {
      await held;
    }
    const planned = this.lookupFailures.get(operation);
    if (planned === undefined) {
      return undefined;
    }
    planned.remaining -= 1;
    if (planned.remaining <= 0) {
      this.lookupFailures.delete(operation);
    }
    if (planned.hang === true) {
      return hangUntilAborted(signal);
    }
    return planned;
  }
}

interface PlannedLookupFailure extends TestLookupFailure {
  remaining: number;
}

function isProviderResult(value: unknown): value is ProviderResult<never> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok: unknown }).ok === "boolean"
  );
}

function asResult<T>(value: T | ProviderResult<T>): ProviderResult<T> {
  return isProviderResult(value) ? value : providerOk(value as T);
}

function hangUntilAborted(signal: ProviderAbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/** TEST ONLY. The same test carrier under a second code, so a spec can prove one carrier's failure does not stop another. */
@Injectable()
@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata(SECOND_TEST_PROVIDER_CODE))
export class SecondTestShippingProvider extends TestShippingProvider {
  override readonly code: string = SECOND_TEST_PROVIDER_CODE;
}

@Module({ providers: [TestShippingProvider], exports: [TestShippingProvider] })
class TestShippingProviderModule {}

@Module({ providers: [SecondTestShippingProvider], exports: [SecondTestShippingProvider] })
class SecondTestShippingProviderModule {}

export function testShippingProviders(
  options: { second?: boolean } = {},
): LoadedShippingProvider[] {
  const loaded: LoadedShippingProvider[] = [
    { code: TEST_PROVIDER_CODE, module: TestShippingProviderModule as Type<unknown> },
  ];
  if (options.second === true) {
    loaded.push({
      code: SECOND_TEST_PROVIDER_CODE,
      module: SecondTestShippingProviderModule as Type<unknown>,
    });
  }
  return loaded;
}

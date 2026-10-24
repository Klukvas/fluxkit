import { Injectable, Module, SetMetadata, type Type } from "@nestjs/common";
import {
  providerFailure,
  providerOk,
  SHIPPING_PROVIDER_METADATA,
  shippingProviderMetadata,
  type CityResult,
  type EstimateRequest,
  type Money,
  type PickupPoint,
  type PickupPointKind,
  type ProviderAbortSignal,
  type ProviderFailureReason,
  type ProviderResult,
  type ShippingProviderPort,
} from "@fluxkit/core";
import type { LoadedShippingProvider } from "../shipping/registry/index.js";

/** Code of the in-repo test provider. Specs mount it with `startApp({ extraShippingProviders: testShippingProviders() })`. */
export const TEST_PROVIDER_CODE = "fake";

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

/** The estimate the test provider quotes for any destination, in the currency of the declared value. */
export const TEST_ESTIMATE_MINOR_UNITS = 6_000;

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

const unused = (): never => {
  throw new Error("The test shipping provider does not implement this operation");
};

interface PlannedLookupFailure extends TestLookupFailure {
  remaining: number;
}

/**
 * TEST ONLY. A small provider that lives in apps/api, so core and API specs depend on no package under packages/providers
 * (the CI mode providers-deleted removes them). It serves a fixed directory (two cities, three points, all in `UA`) and a
 * fixed estimate, counts every call, and lets a spec plan failures (`failNext` for `checkConnection`, `failLookup` for the
 * store calls) or hold calls until it releases them (`hold`, for request coalescing). The waybill operations throw: a
 * spec that starts using them has to say what they should answer first.
 */
@Injectable()
@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata(TEST_PROVIDER_CODE))
export class TestShippingProvider implements ShippingProviderPort {
  readonly code = TEST_PROVIDER_CODE;
  readonly capabilities = Object.freeze({
    pickupPoints: true,
    estimate: true,
    waybills: false,
    cancelWaybill: false,
    tracking: false,
    labels: false,
  });
  /** The directory the lookups answer from; a spec may replace it. */
  cities: readonly CityResult[] = TEST_CITIES;
  points: readonly PickupPoint[] = TEST_POINTS;
  estimateAmount = TEST_ESTIMATE_MINOR_UNITS;
  readonly calls: Record<TestLookupOperation, number> = {
    searchCities: 0,
    listPickupPoints: 0,
    findPickupPoint: 0,
    estimate: 0,
  };
  private pending: (TestProviderFailure & { remaining: number }) | undefined;
  private readonly lookupFailures = new Map<TestLookupOperation, PlannedLookupFailure>();
  private readonly held = new Map<TestLookupOperation, Promise<void>>();

  createWaybill = unused;
  findWaybill = unused;
  cancelWaybill = unused;
  track = unused;
  fetchLabel = unused;

  failNext(failure: TestProviderFailure = {}): void {
    this.pending = { ...failure, remaining: 1 };
  }

  /** The next `times` calls of `operation` fail as described. Replaces an earlier plan for that operation. */
  failLookup(operation: TestLookupOperation, failure: TestLookupFailure = {}): void {
    this.lookupFailures.set(operation, { ...failure, remaining: failure.times ?? 1 });
  }

  /** Every call of `operation` waits until the returned function is called (then they all go on). */
  hold(operation: TestLookupOperation): () => void {
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

  /** Forgets planned failures, holds, counts and directory changes. */
  reset(): void {
    this.pending = undefined;
    this.lookupFailures.clear();
    this.held.clear();
    this.cities = TEST_CITIES;
    this.points = TEST_POINTS;
    this.estimateAmount = TEST_ESTIMATE_MINOR_UNITS;
    for (const operation of TEST_LOOKUP_OPERATIONS) {
      this.calls[operation] = 0;
    }
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

@Module({ providers: [TestShippingProvider], exports: [TestShippingProvider] })
class TestShippingProviderModule {}

export function testShippingProviders(): LoadedShippingProvider[] {
  return [{ code: TEST_PROVIDER_CODE, module: TestShippingProviderModule as Type<unknown> }];
}

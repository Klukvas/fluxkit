import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CARRIER_REFERENCE_PATTERN,
  CONTACT_LIMITS,
  COUNTRY_CODE_PATTERN,
  createMoney,
  hasJsonbUnsafeCharacters,
  PICKUP_POINT_KINDS,
  SHIPPING_PROVIDER_TIMEOUTS_MS,
  type CityResult,
  type EstimateRequest,
  type Money,
  type PickupPoint,
  type ShippingProviderPort,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { ShippingProviderRegistry } from "../registry/index.js";
import { ConcurrencyGate, GateBusyError, ProviderCache } from "./provider-cache.js";
import { estimateSubtotalBand, SHIPPING_STORE_LIMITS } from "./shipping-store-limits.js";
import { ShippingStoreRepository } from "./shipping-store.repository.js";

/** A provider call failed (network, timeout, a refusal, a busy gate or an answer that breaks the port). Never a message. */
export class ShippingProviderUnavailableError extends Error {
  constructor(readonly providerCode: string) {
    super(`Shipping provider "${providerCode}" is unavailable`);
    this.name = "ShippingProviderUnavailableError";
  }
}

export type PickupPointResolution =
  | { readonly status: "found"; readonly point: PickupPoint; readonly stale: boolean }
  | { readonly status: "unknown" }
  | { readonly status: "unavailable" };

export interface DirectoryPage<T> {
  readonly items: readonly T[];
  readonly stale: boolean;
}

export interface EstimateQuery {
  readonly providerCode: string;
  readonly methodCode: string;
  readonly service: string | null;
  /** The destination city; for a pickup point its city. */
  readonly cityRef: string;
  readonly pickupPointRef: string | null;
  readonly subtotal: Money;
}

/** Point and city texts must fit an address line (`CONTACT_LIMITS.text`): a pickup point order's address is built from them. */
const TEXT_MAX_LENGTH = CONTACT_LIMITS.text;
const SEPARATOR = "\u0000";

function isText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= TEXT_MAX_LENGTH &&
    !hasJsonbUnsafeCharacters(value)
  );
}

function isCity(value: unknown): value is CityResult {
  const city = value as Partial<CityResult> | null;
  return (
    typeof city === "object" &&
    city !== null &&
    typeof city.ref === "string" &&
    CARRIER_REFERENCE_PATTERN.test(city.ref) &&
    isText(city.name) &&
    (city.region === null || isText(city.region))
  );
}

function isPoint(value: unknown): value is PickupPoint {
  const point = value as Partial<PickupPoint> | null;
  return (
    typeof point === "object" &&
    point !== null &&
    typeof point.ref === "string" &&
    CARRIER_REFERENCE_PATTERN.test(point.ref) &&
    typeof point.cityRef === "string" &&
    CARRIER_REFERENCE_PATTERN.test(point.cityRef) &&
    typeof point.countryCode === "string" &&
    COUNTRY_CODE_PATTERN.test(point.countryCode) &&
    PICKUP_POINT_KINDS.includes(point.kind as never) &&
    isText(point.number) &&
    isText(point.cityName) &&
    isText(point.description) &&
    (point.maxWeightGrams === null ||
      (Number.isSafeInteger(point.maxWeightGrams) && (point.maxWeightGrams ?? 0) > 0))
  );
}

/** The work's promise, or a rejection as soon as the signal aborts (a provider that ignores the signal is not waited for). */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // A late rejection of the abandoned call must not become an unhandled rejection.
  work.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Carrier directories and estimates for the store (ADR 0029 decisions 5 and 6): every call goes through the registry with
 * the API's time limit (`SHIPPING_PROVIDER_TIMEOUTS_MS`) and the per-provider gate (at most 4 in flight per process), and
 * its answer through the in-process cache. Never inside a database transaction or under a lock: the callers are the store
 * routes and the checkout's step BEFORE its transaction. Logs carry the provider code, the operation, the kind of failure
 * and the duration only: never a provider's message (it can echo a name, a phone or the key) and never a request value.
 * A provider answer that breaks the port (a malformed ref, an empty text) is dropped and counted in a warning.
 */
@Injectable()
export class ShippingDirectoryService {
  private readonly logger = new Logger("ShippingDirectory");
  private readonly gates = new Map<string, ConcurrencyGate>();
  private readonly cities: ProviderCache<readonly CityResult[]>;
  private readonly points: ProviderCache<readonly PickupPoint[]>;
  private readonly pointsByRef: ProviderCache<PickupPoint | null>;
  private readonly estimates: ProviderCache<Money>;

  constructor(
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
    @Inject(ShippingStoreRepository) private readonly repository: ShippingStoreRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    const now = () => this.clock.now().getTime();
    this.cities = new ProviderCache(SHIPPING_STORE_LIMITS.cities, now);
    this.points = new ProviderCache(SHIPPING_STORE_LIMITS.points, now);
    this.pointsByRef = new ProviderCache(SHIPPING_STORE_LIMITS.pointsByRef, now);
    this.estimates = new ProviderCache(SHIPPING_STORE_LIMITS.estimates, now);
  }

  /** The loaded provider of that code, or `undefined` (not enabled, or deleted). */
  provider(code: string): ShippingProviderPort | undefined {
    return this.registry.get(code);
  }

  /** City search by normalized query (lower case, single spaces). Throws `ShippingProviderUnavailableError`. */
  async searchCities(
    provider: ShippingProviderPort,
    query: string,
    locale: string,
  ): Promise<DirectoryPage<CityResult>> {
    const normalized = query.trim().replace(/\s+/gu, " ").toLowerCase();
    const key = [provider.code, locale, normalized].join(SEPARATOR);
    const read = await this.cities.get(key, async () => {
      const found = await this.call(provider, "searchCities", "lookup", (signal) =>
        provider.searchCities(
          { query: normalized, locale, limit: SHIPPING_STORE_LIMITS.citiesPerSearch },
          signal,
        ),
      );
      return Object.freeze(
        this.valid(provider.code, "searchCities", found, isCity).slice(
          0,
          SHIPPING_STORE_LIMITS.citiesPerSearch,
        ),
      );
    });
    return { items: read.value, stale: read.stale };
  }

  /** The full point list of a city (both kinds), fetched once and filtered by the caller. Throws when unavailable. */
  async listPickupPoints(
    provider: ShippingProviderPort,
    cityRef: string,
  ): Promise<DirectoryPage<PickupPoint>> {
    const read = await this.points.get([provider.code, cityRef].join(SEPARATOR), async () => {
      const found = await this.call(provider, "listPickupPoints", "lookup", (signal) =>
        provider.listPickupPoints({ cityRef, kinds: PICKUP_POINT_KINDS }, signal),
      );
      const valid = this.valid(provider.code, "listPickupPoints", found, isPoint).filter(
        (point) => point.cityRef === cityRef,
      );
      if (valid.length > SHIPPING_STORE_LIMITS.pointsPerCity) {
        this.logger.warn(
          `Shipping provider "${provider.code}" listPickupPoints returned ${String(valid.length)} points for one city; kept the first ${String(SHIPPING_STORE_LIMITS.pointsPerCity)}.`,
        );
      }
      return Object.freeze(valid.slice(0, SHIPPING_STORE_LIMITS.pointsPerCity));
    });
    return { items: read.value, stale: read.stale };
  }

  /**
   * A point by its ref: from a city list or an earlier resolution when fresh, else ONE `findPickupPoint` call (coalesced);
   * on a provider failure a stale entry within the window, else `unavailable`. Never throws for a provider failure.
   */
  async resolvePickupPoint(
    provider: ShippingProviderPort,
    ref: string,
  ): Promise<PickupPointResolution> {
    const listed = this.findInLists(provider.code, ref, false);
    if (listed !== undefined) {
      return { status: "found", point: listed, stale: false };
    }
    const key = [provider.code, ref].join(SEPARATOR);
    try {
      const read = await this.pointsByRef.get(key, async () => {
        const found = await this.call(provider, "findPickupPoint", "lookup", (signal) =>
          provider.findPickupPoint({ ref }, signal),
        );
        if (found === null) {
          return null;
        }
        if (!isPoint(found) || found.ref !== ref) {
          this.logger.warn(
            `Shipping provider "${provider.code}" findPickupPoint answered a point that breaks the port.`,
          );
          throw new ShippingProviderUnavailableError(provider.code);
        }
        return Object.freeze({ ...found });
      });
      if (read.value === null) {
        // Unknown refs are not kept: a point opened later is found on the next try.
        this.pointsByRef.delete(key);
        return { status: "unknown" };
      }
      return { status: "found", point: read.value, stale: read.stale };
    } catch (error) {
      if (!(error instanceof ShippingProviderUnavailableError)) {
        throw error;
      }
      const stale = this.findInLists(provider.code, ref, true);
      return stale === undefined
        ? { status: "unavailable" }
        : { status: "found", point: stale, stale: true };
    }
  }

  /** The point from the cache only (fresh, or stale within the window); no call. For the checkout's transaction. */
  peekPickupPoint(providerCode: string, ref: string): PickupPoint | undefined {
    return (
      this.findInLists(providerCode, ref, true) ??
      this.pointsByRef.peek([providerCode, ref].join(SEPARATOR), { allowStale: true })?.value ??
      undefined
    );
  }

  /**
   * The carrier's informational price (ADR 0029 decisions 2 and 5): cached 10 minutes per (method, city, point, subtotal
   * band); `null` on any failure, never an error of the caller. Never part of a total.
   */
  async estimate(provider: ShippingProviderPort, query: EstimateQuery): Promise<Money | null> {
    if (!provider.capabilities.estimate) {
      return null;
    }
    const key = this.estimateKey(query);
    try {
      const read = await this.estimates.get(key, async () => {
        const settings = await this.repository.providerSettings(provider.code);
        const request: EstimateRequest = {
          service: query.service,
          destination:
            query.pickupPointRef === null
              ? { kind: "city", cityRef: query.cityRef }
              : {
                  kind: "pickup_point",
                  cityRef: query.cityRef,
                  pickupPointRef: query.pickupPointRef,
                },
          declaredValue: query.subtotal,
          parcel: null,
          settings,
        };
        const result = await this.call(provider, "estimate", "estimate", (signal) =>
          provider.estimate(request, signal),
        );
        if (!result.ok) {
          this.logger.warn(
            `Shipping provider "${provider.code}" estimate refused (${result.reason}${result.providerCodes.length > 0 ? `: ${result.providerCodes.join(",")}` : ""}).`,
          );
          throw new ShippingProviderUnavailableError(provider.code);
        }
        const money = createMoney(result.value.amount, result.value.currency);
        if (
          !money.ok ||
          money.money.amount < 0 ||
          money.money.currency !== query.subtotal.currency
        ) {
          this.logger.warn(
            `Shipping provider "${provider.code}" estimate answered an amount that breaks the port.`,
          );
          throw new ShippingProviderUnavailableError(provider.code);
        }
        return money.money;
      });
      return read.value;
    } catch (error) {
      if (error instanceof ShippingProviderUnavailableError) {
        return null;
      }
      throw error;
    }
  }

  /** The cached estimate only (no call): what the checkout records as `estimated_carrier_amount`. */
  peekEstimate(query: EstimateQuery): Money | null {
    return this.estimates.peek(this.estimateKey(query))?.value ?? null;
  }

  private estimateKey(query: EstimateQuery): string {
    return [
      query.providerCode,
      query.methodCode,
      query.cityRef,
      query.pickupPointRef ?? "",
      String(estimateSubtotalBand(query.subtotal.amount)),
      query.subtotal.currency,
    ].join(SEPARATOR);
  }

  /** A point of a cached city list of this provider: fresh lists only, or stale ones within the window too. */
  private findInLists(
    providerCode: string,
    ref: string,
    allowStale: boolean,
  ): PickupPoint | undefined {
    const prefix = `${providerCode}${SEPARATOR}`;
    for (const entry of this.points.usable()) {
      if (!entry.key.startsWith(prefix) || (entry.stale && !allowStale)) {
        continue;
      }
      const found = entry.value.find((point) => point.ref === ref);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  private valid<T>(
    providerCode: string,
    operation: string,
    found: unknown,
    check: (value: unknown) => value is T,
  ): T[] {
    if (!Array.isArray(found)) {
      this.logger.warn(`Shipping provider "${providerCode}" ${operation} did not answer a list.`);
      throw new ShippingProviderUnavailableError(providerCode);
    }
    const valid = found.filter(check);
    if (valid.length !== found.length) {
      this.logger.warn(
        `Shipping provider "${providerCode}" ${operation} answered ${String(found.length - valid.length)} entries that break the port; they were dropped.`,
      );
    }
    return valid.map((entry) => Object.freeze({ ...entry }));
  }

  private gateOf(providerCode: string): ConcurrencyGate {
    let gate = this.gates.get(providerCode);
    if (gate === undefined) {
      gate = new ConcurrencyGate(
        SHIPPING_STORE_LIMITS.maxCallsInFlight,
        SHIPPING_STORE_LIMITS.maxCallsQueued,
      );
      this.gates.set(providerCode, gate);
    }
    return gate;
  }

  /** One provider call with the API's time limit, through the gate. Any failure is `ShippingProviderUnavailableError`. */
  private async call<T>(
    provider: ShippingProviderPort,
    operation: string,
    timeout: keyof typeof SHIPPING_PROVIDER_TIMEOUTS_MS,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error("timeout"));
    }, SHIPPING_PROVIDER_TIMEOUTS_MS[timeout]);
    const started = performance.now();
    try {
      return await this.gateOf(provider.code).run(controller.signal, () =>
        untilAborted(
          Promise.resolve().then(() => work(controller.signal)),
          controller.signal,
        ),
      );
    } catch (error) {
      const kind = controller.signal.aborted
        ? "timeout"
        : error instanceof GateBusyError
          ? "busy"
          : "error";
      // Never the error's message or stack: a provider's text can carry personal data or the key.
      this.logger.warn(
        `Shipping provider "${provider.code}" ${operation} failed (${kind}) after ${String(Math.round(performance.now() - started))} ms.`,
      );
      throw new ShippingProviderUnavailableError(provider.code);
    } finally {
      clearTimeout(timer);
    }
  }
}

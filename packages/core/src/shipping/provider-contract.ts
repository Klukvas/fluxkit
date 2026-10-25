import { isSupportedCurrency } from "../pricing/currency.js";
import { MAX_AMOUNT } from "../pricing/limits.js";
import {
  CARRIER_CODE_PATTERN,
  CARRIER_REFERENCE_PATTERN,
  COUNTRY_CODE_PATTERN,
  SHIPPING_PROVIDER_CODE_PATTERN,
} from "./limits.js";
import {
  isProviderSettingsIssueList,
  MAX_PROVIDER_CODES,
  PICKUP_POINT_KINDS,
  PROVIDER_FAILURE_REASONS,
  SHIPPING_CAPABILITIES,
  type ProviderAbortSignal,
  type ProviderResult,
  type ShippingProviderPort,
  type WaybillCreated,
  type WaybillRequest,
} from "./provider-port.js";
import { CARRIER_REPORTED_SHIPMENT_STATUSES } from "./shipment-status.js";

/*
 * The reusable provider contract check (ADR 0029 decision 9: "a reusable contract test suite runs against every provider
 * package"; plan step 7b). Pure and framework-free: it calls the provider with a scenario the provider's own spec supplies
 * (its fixtures, a stub carrier) and returns every rule the answers break, as plain sentences. A provider spec asserts
 * that the list is empty. It checks shapes and port rules only, never a carrier's business data.
 */

/** What a provider spec supplies: inputs its fixtures answer, and how to make signals (core has no AbortController). */
export interface ShippingProviderContractScenario {
  /** A city search the fixtures answer with at least one city. */
  readonly cityQuery: { readonly query: string; readonly locale: string };
  /** A city that has at least one branch and one locker. */
  readonly cityRef: string;
  /** A point of that city that `findPickupPoint` finds. */
  readonly pickupPointRef: string;
  /** A well-formed ref of no point (`findPickupPoint` answers `null`). */
  readonly unknownPickupPointRef: string;
  /** A request `createWaybill` accepts (when the provider offers waybills). */
  readonly waybill: WaybillRequest;
  /** Settings `validateSettings` accepts, and settings it refuses (`null`: the provider has no settings and refuses none). */
  readonly validSettings: Readonly<Record<string, unknown>>;
  readonly invalidSettings: Readonly<Record<string, unknown>> | null;
  /** A signal that never fires, and one that has already fired. */
  readonly liveSignal: () => ProviderAbortSignal;
  readonly abortedSignal: () => ProviderAbortSignal;
}

type Violations = string[];

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isResult(value: unknown): value is ProviderResult<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const result = value as { ok?: unknown; reason?: unknown; providerCodes?: unknown };
  if (result.ok === true) {
    return "value" in result;
  }
  return (
    result.ok === false &&
    PROVIDER_FAILURE_REASONS.includes(result.reason as never) &&
    Array.isArray(result.providerCodes) &&
    result.providerCodes.length <= MAX_PROVIDER_CODES &&
    result.providerCodes.every(
      (code: unknown) => typeof code === "string" && CARRIER_CODE_PATTERN.test(code),
    )
  );
}

function isMoneyOf(value: unknown, currency: string): boolean {
  const money = value as { amount?: unknown; currency?: unknown } | null;
  return (
    typeof money === "object" &&
    money !== null &&
    Number.isSafeInteger(money.amount) &&
    (money.amount as number) >= 0 &&
    (money.amount as number) <= MAX_AMOUNT &&
    money.currency === currency &&
    isSupportedCurrency(money.currency)
  );
}

function pointProblems(value: unknown, cityRef: string, kinds: readonly string[]): string[] {
  const point = value as Record<string, unknown> | null;
  if (typeof point !== "object" || point === null) {
    return ["is not an object"];
  }
  const problems: string[] = [];
  if (typeof point.ref !== "string" || !CARRIER_REFERENCE_PATTERN.test(point.ref)) {
    problems.push("ref breaks CARRIER_REFERENCE_PATTERN");
  }
  if (point.cityRef !== cityRef) {
    problems.push("cityRef is not the requested city");
  }
  if (!kinds.includes(point.kind as string)) {
    problems.push("kind is not one of the requested kinds");
  }
  if (typeof point.countryCode !== "string" || !COUNTRY_CODE_PATTERN.test(point.countryCode)) {
    problems.push("countryCode breaks COUNTRY_CODE_PATTERN");
  }
  for (const field of ["number", "cityName", "description"]) {
    if (!isText(point[field])) {
      problems.push(`${field} is not a non-empty text`);
    }
  }
  const weight = point.maxWeightGrams;
  if (weight !== null && !(Number.isSafeInteger(weight) && (weight as number) > 0)) {
    problems.push("maxWeightGrams is neither null nor a positive integer");
  }
  return problems;
}

function waybillProblems(value: unknown, currency: string): string[] {
  const waybill = value as Partial<WaybillCreated> | null;
  if (typeof waybill !== "object" || waybill === null) {
    return ["is not an object"];
  }
  const problems: string[] = [];
  if (
    typeof waybill.providerRef !== "string" ||
    !CARRIER_REFERENCE_PATTERN.test(waybill.providerRef)
  ) {
    problems.push("providerRef breaks CARRIER_REFERENCE_PATTERN");
  }
  if (
    typeof waybill.trackingNumber !== "string" ||
    !CARRIER_REFERENCE_PATTERN.test(waybill.trackingNumber)
  ) {
    problems.push("trackingNumber breaks CARRIER_REFERENCE_PATTERN");
  }
  if (waybill.carrierCost !== null && !isMoneyOf(waybill.carrierCost, currency)) {
    problems.push("carrierCost is neither null nor money in the declared currency");
  }
  if (
    waybill.estimatedDeliveryDate !== null &&
    !(
      typeof waybill.estimatedDeliveryDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(waybill.estimatedDeliveryDate)
    )
  ) {
    problems.push("estimatedDeliveryDate is neither null nor YYYY-MM-DD");
  }
  return problems;
}

/** Runs `work`; a rejection is recorded as a violation (unless `rejects` is allowed) and answers `undefined`. */
async function attempt<T>(
  violations: Violations,
  operation: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    violations.push(
      `${operation} threw (${error instanceof Error ? error.constructor.name : typeof error})`,
    );
    return undefined;
  }
}

/**
 * Every rule of `ShippingProviderPort` the provider breaks under `scenario`, as sentences; empty when it keeps them all.
 * Creates (and cancels) one waybill when the provider offers waybills.
 */
export async function checkShippingProviderContract(
  provider: ShippingProviderPort,
  scenario: ShippingProviderContractScenario,
): Promise<string[]> {
  const violations: Violations = [];
  const live = scenario.liveSignal;

  // Identity and capabilities.
  if (typeof provider.code !== "string" || !SHIPPING_PROVIDER_CODE_PATTERN.test(provider.code)) {
    violations.push("code breaks SHIPPING_PROVIDER_CODE_PATTERN");
  }
  const capabilities = provider.capabilities as Record<string, unknown> | null | undefined;
  for (const capability of SHIPPING_CAPABILITIES) {
    if (typeof capabilities?.[capability] !== "boolean") {
      violations.push(`capability ${capability} is not a boolean`);
    }
  }

  // Settings.
  const accepted: unknown = provider.validateSettings(scenario.validSettings);
  if (!isProviderSettingsIssueList(accepted) || accepted.length !== 0) {
    violations.push("validateSettings does not accept the valid settings with an empty list");
  }
  if (scenario.invalidSettings !== null) {
    const refused: unknown = provider.validateSettings(scenario.invalidSettings);
    if (!isProviderSettingsIssueList(refused) || refused.length === 0) {
      violations.push(
        "validateSettings does not refuse the invalid settings with well-formed issues",
      );
    }
  }

  // Lookups (they throw on failure; here they must answer).
  if (provider.capabilities.pickupPoints) {
    const limit = 5;
    const cities = await attempt(violations, "searchCities", () =>
      provider.searchCities({ ...scenario.cityQuery, limit }, live()),
    );
    if (cities !== undefined) {
      if (!Array.isArray(cities) || cities.length === 0 || cities.length > limit) {
        violations.push("searchCities did not answer 1 to limit cities");
      } else {
        for (const city of cities as unknown[]) {
          const entry = city as Record<string, unknown> | null;
          if (
            typeof entry !== "object" ||
            entry === null ||
            typeof entry.ref !== "string" ||
            !CARRIER_REFERENCE_PATTERN.test(entry.ref) ||
            !isText(entry.name) ||
            !(entry.region === null || isText(entry.region))
          ) {
            violations.push("searchCities answered a city that breaks the port");
          }
        }
      }
    }
    const points = await attempt(violations, "listPickupPoints", () =>
      provider.listPickupPoints({ cityRef: scenario.cityRef, kinds: PICKUP_POINT_KINDS }, live()),
    );
    if (points !== undefined) {
      if (!Array.isArray(points) || points.length === 0) {
        violations.push("listPickupPoints did not answer a non-empty list");
      } else {
        for (const point of points as unknown[]) {
          for (const problem of pointProblems(point, scenario.cityRef, PICKUP_POINT_KINDS)) {
            violations.push(`listPickupPoints: a point ${problem}`);
          }
        }
      }
    }
    const lockers = await attempt(violations, "listPickupPoints (lockers)", () =>
      provider.listPickupPoints({ cityRef: scenario.cityRef, kinds: ["locker"] }, live()),
    );
    if (Array.isArray(lockers) && lockers.some((point) => point.kind !== "locker")) {
      violations.push("listPickupPoints answered a kind that was not asked for");
    }
    const found = await attempt(violations, "findPickupPoint", () =>
      provider.findPickupPoint({ ref: scenario.pickupPointRef }, live()),
    );
    if (found !== undefined) {
      if (found === null || found.ref !== scenario.pickupPointRef) {
        violations.push("findPickupPoint did not find the scenario's point by its ref");
      } else {
        for (const problem of pointProblems(found, found.cityRef, PICKUP_POINT_KINDS)) {
          violations.push(`findPickupPoint: the point ${problem}`);
        }
      }
    }
    const unknown = await attempt(violations, "findPickupPoint (unknown)", () =>
      provider.findPickupPoint({ ref: scenario.unknownPickupPointRef }, live()),
    );
    if (unknown !== undefined && unknown !== null) {
      violations.push("findPickupPoint answered a point for an unknown ref");
    }
  }

  // Estimate (informational; a typed failure is allowed).
  const currency = scenario.waybill.declaredValue.currency;
  const estimate = await attempt(violations, "estimate", () =>
    provider.estimate(
      {
        service: scenario.waybill.service,
        destination: scenario.waybill.destination,
        declaredValue: scenario.waybill.declaredValue,
        parcel: scenario.waybill.parcel,
        settings: scenario.waybill.settings,
      },
      live(),
    ),
  );
  if (estimate !== undefined) {
    if (!isResult(estimate)) {
      violations.push("estimate did not answer a ProviderResult with codes, not text");
    } else if (estimate.ok && !isMoneyOf(estimate.value, currency)) {
      violations.push("estimate answered an amount that is not money in the declared currency");
    } else if (
      !provider.capabilities.estimate &&
      (estimate.ok || estimate.reason !== "not_supported")
    ) {
      violations.push("estimate is not offered but did not answer not_supported");
    }
  }

  // Waybills.
  if (provider.capabilities.waybills) {
    const created = await attempt(violations, "createWaybill", () =>
      provider.createWaybill(scenario.waybill, live()),
    );
    if (created !== undefined && !(isResult(created) && created.ok)) {
      violations.push("createWaybill did not create a waybill for the scenario's request");
    }
    const waybill =
      created !== undefined && isResult(created) && created.ok ? created.value : undefined;
    for (const problem of waybill === undefined ? [] : waybillProblems(waybill, currency)) {
      violations.push(`createWaybill: the waybill ${problem}`);
    }
    if (waybill !== undefined) {
      const lookup = await attempt(violations, "findWaybill", () =>
        provider.findWaybill(
          {
            clientReference: scenario.waybill.clientReference,
            createdAfter: "1970-01-01T00:00:00.000Z",
            createdBefore: "2100-01-01T00:00:00.000Z",
          },
          live(),
        ),
      );
      if (
        lookup !== undefined &&
        !(isResult(lookup) && lookup.ok && lookup.value?.trackingNumber === waybill.trackingNumber)
      ) {
        violations.push("findWaybill did not find the created waybill in a wide window");
      }
      const tracked = provider.capabilities.tracking
        ? await attempt(violations, "track", () =>
            provider.track({ trackingNumbers: [waybill.trackingNumber], phones: [] }, live()),
          )
        : undefined;
      if (tracked !== undefined) {
        if (!isResult(tracked) || !tracked.ok || !Array.isArray(tracked.value)) {
          violations.push("track did not answer a list of updates");
        } else {
          for (const entry of tracked.value as unknown[]) {
            const update = entry as Record<string, unknown> | null;
            if (
              typeof update !== "object" ||
              update === null ||
              update.trackingNumber !== waybill.trackingNumber ||
              !(
                update.status === null ||
                CARRIER_REPORTED_SHIPMENT_STATUSES.includes(update.status as never)
              ) ||
              typeof update.carrierStatusCode !== "string" ||
              !CARRIER_CODE_PATTERN.test(update.carrierStatusCode) ||
              !(
                update.carrierStatusAt === null ||
                (update.carrierStatusAt instanceof Date &&
                  !Number.isNaN(update.carrierStatusAt.getTime()))
              )
            ) {
              violations.push("track answered an update that breaks the port");
            }
          }
        }
      }
      const label = provider.capabilities.labels
        ? await attempt(violations, "fetchLabel", () =>
            provider.fetchLabel(
              {
                providerRef: waybill.providerRef,
                trackingNumber: waybill.trackingNumber,
                format: "pdf",
              },
              live(),
            ),
          )
        : undefined;
      if (label !== undefined) {
        if (!isResult(label)) {
          violations.push("fetchLabel did not answer a ProviderResult with codes, not text");
        } else if (label.ok) {
          const value = label.value as { bytes?: unknown; contentType?: unknown };
          const bytes = value.bytes;
          if (
            value.contentType !== "application/pdf" ||
            !(bytes instanceof Uint8Array) ||
            PDF_MAGIC.some((byte, index) => bytes[index] !== byte)
          ) {
            violations.push("fetchLabel answered something that is not a PDF");
          }
        }
      }
      if (provider.capabilities.cancelWaybill) {
        const cancelled = await attempt(violations, "cancelWaybill", () =>
          provider.cancelWaybill({ providerRef: waybill.providerRef }, live()),
        );
        if (cancelled !== undefined && !(isResult(cancelled) && cancelled.ok)) {
          violations.push("cancelWaybill did not cancel the created waybill");
        }
      }
    }
    const inverted = await provider
      .findWaybill(
        {
          clientReference: scenario.waybill.clientReference,
          createdAfter: "2100-01-01T00:00:00.000Z",
          createdBefore: "1970-01-01T00:00:00.000Z",
        },
        live(),
      )
      .catch(() => undefined);
    if (inverted !== undefined && (!isResult(inverted) || inverted.ok)) {
      violations.push("findWaybill answered success for a window that is not two ordered instants");
    }
  }

  const connection = await attempt(violations, "checkConnection", () =>
    provider.checkConnection(live()),
  );
  if (connection !== undefined && !isResult(connection)) {
    violations.push("checkConnection did not answer a ProviderResult with codes, not text");
  }

  // An already aborted signal: every operation rejects or answers a failure, never a success.
  const calls: [string, (signal: ProviderAbortSignal) => Promise<unknown>][] = [
    ["searchCities", (s) => provider.searchCities({ ...scenario.cityQuery, limit: 5 }, s)],
    [
      "listPickupPoints",
      (s) => provider.listPickupPoints({ cityRef: scenario.cityRef, kinds: PICKUP_POINT_KINDS }, s),
    ],
    ["findPickupPoint", (s) => provider.findPickupPoint({ ref: scenario.pickupPointRef }, s)],
    [
      "findWaybill",
      (s) =>
        provider.findWaybill(
          {
            clientReference: scenario.waybill.clientReference,
            createdAfter: "1970-01-01T00:00:00.000Z",
            createdBefore: "2100-01-01T00:00:00.000Z",
          },
          s,
        ),
    ],
    ["track", (s) => provider.track({ trackingNumbers: ["0"], phones: [] }, s)],
    ["checkConnection", (s) => provider.checkConnection(s)],
  ];
  for (const [operation, call] of calls) {
    let answer: unknown;
    try {
      answer = await call(scenario.abortedSignal());
    } catch {
      continue;
    }
    if (!(isResult(answer) && !answer.ok)) {
      violations.push(`${operation} answered with an aborted signal instead of failing`);
    }
  }
  return violations;
}

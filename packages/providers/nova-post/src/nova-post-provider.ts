import { Inject, Injectable, SetMetadata } from "@nestjs/common";
import {
  CARRIER_REFERENCE_PATTERN,
  MAX_PROVIDER_CODES,
  parseDecimalString,
  PROVIDER_CODE_NOT_SENT,
  providerFailure,
  providerOk,
  SHIPPING_LIMITS,
  SHIPPING_PROVIDER_METADATA,
  SHIPPING_PROVIDER_TIMEOUTS_MS,
  shippingProviderMetadata,
  type CityResult,
  type EstimateRequest,
  type Money,
  type PickupPoint,
  type PickupPointKind,
  type ProviderResult,
  type ProviderSettingsIssue,
  type ShippingCapabilities,
  type ShippingProviderPort,
  type TrackingUpdate,
  type WaybillCreated,
  type WaybillLookup,
  type WaybillRequest,
} from "@fluxkit/core";
import {
  carrierCodesOf,
  hasCarrierCode,
  namesRequestField,
  NOVA_POST_SIZE_CAPS,
  NovaPostCallError,
  NovaPostHttp,
  type Answer,
  type NovaPostLogger,
  type RequestSpec,
} from "./http.js";
import {
  calculationAnswerSchema,
  createdShipmentSchema,
  divisionSchema,
  pageSchema,
  settlementSchema,
  shipmentRowSchema,
  trackingDocumentedSchema,
  trackingItemsSchema,
  type Division,
  type StatusRow,
} from "./schemas.js";
import {
  NOVA_POST_PHONE_PATTERN,
  novaPostSettingsIssues,
  parseNovaPostSettings,
} from "./settings.js";
import { mapNovaPostStatus } from "./status-map.js";

/*
 * The Nova Post shipping provider (new REST API v.1.0, ADR 0030; plan `docs/plans/2026-10-25-nova-post-plugin.md`).
 * Every carrier fact used here is cited in that plan (spike 7a on production and its rerun, the official docs).
 * - Lookups throw `NovaPostCallError` on failure (the port's rule); result operations answer typed failures.
 * - A create is never repeated: no idempotency exists (spike 7a H22). A lost answer is the API's `unknown` + reconcile.
 * - Names, phones and emails go only into request bodies; never into logs, errors or codes.
 */

export const NOVA_POST_PROVIDER_CODE = "nova_post";

/** Injection tokens of the module (`index.ts`). */
export const NOVA_POST_HTTP = Symbol("fluxkit:nova-post-http");
export const NOVA_POST_LOGGER = Symbol("fluxkit:nova-post-logger");

const CAPABILITIES: ShippingCapabilities = Object.freeze({
  pickupPoints: true,
  estimate: true,
  waybills: true,
  cancelWaybill: true,
  tracking: true,
  labels: true,
});

/** Division categories per point kind (rerun 2026-10-25, H12). `PUDO` partner points are not offered in v1. */
export const NOVA_POST_CATEGORIES: Readonly<Record<PickupPointKind, readonly string[]>> =
  Object.freeze({
    branch: Object.freeze(["PostBranch", "CargoBranch"]),
    locker: Object.freeze(["Postomat"]),
  });

/** Largest page the plugin asks for (H15: settlements accept 100, divisions 101, shipments more). */
export const NOVA_POST_PAGE_LIMIT = 100;

/** Most pages one city list reads (branches first, then lockers), and how many are in flight at once. */
export const NOVA_POST_LIST_MAX_PAGES = 15;
export const NOVA_POST_LIST_PARALLEL_PAGES = 4;

/**
 * The time budget of one city list, from its start (a JWT on a cold cache included), below the API's single lookup limit
 * (`SHIPPING_PROVIDER_TIMEOUTS_MS.lookup`, 5 s) so a slow carrier cuts the list instead of losing all of it (review
 * finding 2). After the deadline no further page is started; a page still in flight at the stop is abandoned. The
 * first branch and locker pages are not cut: without them there is nothing to answer, and the caller's signal bounds them.
 */
export const NOVA_POST_LIST_DEADLINE_MS = 3_500;
export const NOVA_POST_LIST_STOP_MS = 4_500;

/** Most pages of `GET /shipments` one `findWaybill` reads before it answers "could not tell" (never `null`). */
export const NOVA_POST_FIND_MAX_PAGES = 10;

const DIGITS_REF = /^\d{1,10}$/;
const TRACKING_NUMBER = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DESCRIPTION_MAX = 200;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function cut(text: string, max: number): string {
  const points = [...text.trim()];
  return points.length <= max ? points.join("") : `${points.slice(0, max - 1).join("")}…`;
}

function languageOf(locale: string): "uk" | "en" {
  return locale.toLowerCase().startsWith("uk") ? "uk" : "en";
}

/** Whole hryvnias, rounded UP (the declared value never shrinks; integers are what the API took, H35). */
function wholeHryvnias(money: Money): number {
  return Math.ceil(money.amount / 100);
}

/** A carrier amount in hryvnias as minor units; `undefined` when it is not a plain amount with at most 2 decimals. */
function hryvniasToMinor(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const parsed = parseDecimalString(String(value), "UAH");
  return parsed.ok ? parsed.money.amount : undefined;
}

/** The Kyiv calendar date of an instant (`YYYY-MM-DD`), or `null`. */
function kyivDate(instant: string | null | undefined): string | null {
  if (typeof instant !== "string") {
    return null;
  }
  const at = Date.parse(instant);
  if (!Number.isFinite(at)) {
    return null;
  }
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** `380XXXXXXXXX` from what a shopper typed (`+380 50 123 45 67`, `050 123 45 67`), or `undefined`. */
export function novaPostPhone(raw: string): string | undefined {
  const digits = raw.replace(/[\s()+-]/g, "");
  const full = /^0\d{9}$/.test(digits) ? `38${digits}` : digits;
  return NOVA_POST_PHONE_PATTERN.test(full) ? full : undefined;
}

/** The common mapping of a non-success status of a result operation (route-specific cases come first). */
function failureOf(answer: Answer): ProviderResult<never> {
  const codes = carrierCodesOf(answer.status, answer.json);
  if (answer.status === 429 || answer.status >= 500) {
    return providerFailure("unavailable", codes);
  }
  return providerFailure("rejected", codes);
}

function caught(error: unknown): ProviderResult<never> {
  if (error instanceof NovaPostCallError) {
    return providerFailure(error.reason, error.codes);
  }
  throw error;
}

function malformed(operation: string): NovaPostCallError {
  return new NovaPostCallError(operation, "unavailable", ["malformed_answer"]);
}

@Injectable()
@SetMetadata(SHIPPING_PROVIDER_METADATA, shippingProviderMetadata(NOVA_POST_PROVIDER_CODE))
export class NovaPostShippingProvider implements ShippingProviderPort {
  readonly code = NOVA_POST_PROVIDER_CODE;
  readonly capabilities = CAPABILITIES;

  constructor(
    @Inject(NOVA_POST_HTTP) private readonly http: NovaPostHttp,
    @Inject(NOVA_POST_LOGGER) private readonly logger: NovaPostLogger,
  ) {}

  validateSettings(settings: Readonly<Record<string, unknown>>): readonly ProviderSettingsIssue[] {
    return novaPostSettingsIssues(settings);
  }

  async searchCities(
    input: { readonly query: string; readonly locale: string; readonly limit: number },
    signal: AbortSignal,
  ): Promise<CityResult[]> {
    const operation = "searchCities";
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), NOVA_POST_PAGE_LIMIT);
    const answer = await this.http.request(
      this.lookup(operation, "/settlements", NOVA_POST_SIZE_CAPS.settlements, {
        query: { countryCodes: ["UA"], textSearch: input.query.trim(), limit },
        // H11: without the header the names are Latin.
        language: languageOf(input.locale),
      }),
      signal,
    );
    const page = this.page(operation, answer);
    const cities: CityResult[] = [];
    for (const item of page.items) {
      const parsed = settlementSchema.safeParse(item);
      if (!parsed.success) {
        continue;
      }
      const region = [parsed.data.region?.name, parsed.data.region?.parent?.name]
        .filter((part): part is string => typeof part === "string" && part.trim() !== "")
        .map((part) => part.trim());
      cities.push({
        ref: String(parsed.data.id),
        name: cut(parsed.data.name, DESCRIPTION_MAX),
        region: region.length === 0 ? null : cut([...new Set(region)].join(", "), DESCRIPTION_MAX),
      });
    }
    this.dropped(operation, page.items.length - cities.length);
    return cities.slice(0, limit);
  }

  async listPickupPoints(
    input: { readonly cityRef: string; readonly kinds: readonly PickupPointKind[] },
    signal: AbortSignal,
  ): Promise<PickupPoint[]> {
    const operation = "listPickupPoints";
    if (!DIGITS_REF.test(input.cityRef)) {
      return [];
    }
    // The budget starts now, so a JWT on a cold cache counts too (review finding 2).
    const started = performance.now();
    const elapsed = () => performance.now() - started;
    const stop = AbortSignal.any([signal, AbortSignal.timeout(NOVA_POST_LIST_STOP_MS)]);
    const fetchPage = async (kind: PickupPointKind, page: number, pageSignal: AbortSignal) =>
      this.page(
        operation,
        await this.http.request(
          this.lookup(operation, "/divisions", NOVA_POST_SIZE_CAPS.divisions, {
            query: {
              countryCodes: ["UA"],
              settlementIds: [input.cityRef],
              divisionCategories: [...NOVA_POST_CATEGORIES[kind]],
              limit: NOVA_POST_PAGE_LIMIT,
              page,
            },
            language: "uk",
          }),
          pageSignal,
        ),
      );
    // Branches first: in the largest cities the lockers are what a budget cuts (Kyiv: 7 387 of 8 031 points).
    const kinds = (["branch", "locker"] as const).filter((kind) => input.kinds.includes(kind));
    // The first page of each kind together (each tells how many pages its kind has). Not cut by the budget: without them
    // there is nothing to answer; the caller's signal bounds them.
    const firsts = await Promise.all(kinds.map((kind) => fetchPage(kind, 1, signal)));
    // The items of every page read, per kind and page number.
    const read = new Map<PickupPointKind, Map<number, readonly unknown[]>>();
    let total = 0;
    const queue: { kind: PickupPointKind; page: number }[] = [];
    let budget = NOVA_POST_LIST_MAX_PAGES - firsts.length;
    let cutBy: "page budget" | "time budget" | undefined;
    kinds.forEach((kind, index) => {
      const first = firsts[index];
      if (first === undefined) return;
      total += first.total ?? first.items.length;
      read.set(kind, new Map([[1, first.items]]));
      for (let page = 2; page <= first.last_page; page += 1) {
        if (budget === 0) {
          cutBy = "page budget";
          break;
        }
        queue.push({ kind, page });
        budget -= 1;
      }
    });
    const worker = async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (elapsed() >= NOVA_POST_LIST_DEADLINE_MS) {
          cutBy = "time budget";
          queue.length = 0;
          return;
        }
        try {
          const answer = await fetchPage(next.kind, next.page, stop);
          read.get(next.kind)?.set(next.page, answer.items);
        } catch (error) {
          if (error instanceof NovaPostCallError && stop.aborted && !signal.aborted) {
            // Abandoned at the stop: the pages read so far are the answer.
            cutBy = "time budget";
            queue.length = 0;
            return;
          }
          // A failed page fails the list (lookups throw): the other workers start no further page.
          queue.length = 0;
          throw error;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(NOVA_POST_LIST_PARALLEL_PAGES, queue.length) }, worker),
    );
    // Collected in page order per kind, so the answer does not depend on which page came back first.
    const points = new Map<string, PickupPoint>();
    for (const kind of kinds) {
      const pages = read.get(kind) ?? new Map<number, readonly unknown[]>();
      for (const page of [...pages.keys()].sort((a, b) => a - b)) {
        this.collect(pages.get(page) ?? [], kind, input.cityRef, points);
      }
    }
    if (cutBy !== undefined) {
      const limit =
        cutBy === "page budget"
          ? `page budget ${String(NOVA_POST_LIST_MAX_PAGES)}`
          : `time budget ${String(NOVA_POST_LIST_DEADLINE_MS)} ms`;
      this.logger.warn(
        `${operation}: a city lists ${String(total)} points; kept ${String(points.size)} (${limit})`,
      );
    }
    return [...points.values()];
  }

  async findPickupPoint(
    input: { readonly ref: string },
    signal: AbortSignal,
  ): Promise<PickupPoint | null> {
    const operation = "findPickupPoint";
    if (!DIGITS_REF.test(input.ref)) {
      return null;
    }
    // `ids[]` is undocumented but answers exactly that division (spike 7a rerun, H16). Anything else fails closed.
    const answer = await this.http.request(
      this.lookup(operation, "/divisions", NOVA_POST_SIZE_CAPS.divisions, {
        query: { ids: [input.ref], limit: 2 },
        language: "uk",
      }),
      signal,
    );
    const page = this.page(operation, answer);
    if (page.items.length === 0) {
      return null;
    }
    const parsed = page.items.length === 1 ? divisionSchema.safeParse(page.items[0]) : undefined;
    if (parsed === undefined || !parsed.success || String(parsed.data.id) !== input.ref) {
      // The filter may have been ignored (a whole list answered): never pick another point.
      throw malformed(operation);
    }
    const kind = this.kindOf(parsed.data);
    return kind === undefined || parsed.data.prohibitedIssuance === true
      ? null
      : this.pointOf(parsed.data, kind);
  }

  async estimate(input: EstimateRequest, signal: AbortSignal): Promise<ProviderResult<Money>> {
    const operation = "estimate";
    const settings = parseNovaPostSettings(input.settings);
    if (settings === undefined) {
      return providerFailure("rejected", ["settings_invalid"]);
    }
    if (input.destination.kind !== "pickup_point") {
      return providerFailure("not_supported", ["destination_kind"]);
    }
    if (input.declaredValue.currency !== "UAH") {
      // The answer names no currency (H18): only a hryvnia shop can read it.
      return providerFailure("not_supported", ["currency"]);
    }
    if (!DIGITS_REF.test(input.destination.pickupPointRef)) {
      return providerFailure("rejected", ["invalid_pickup_point"]);
    }
    const parcel = input.parcel ?? settings.defaultParcel;
    try {
      const answer = await this.http.request(
        {
          operation,
          method: "POST",
          path: "/shipments/calculations",
          body: {
            payerType: settings.payerDefault,
            parcels: [
              {
                cargoCategory: "parcel",
                insuranceCost: wholeHryvnias(input.declaredValue),
                rowNumber: 1,
                width: parcel.widthMm,
                length: parcel.lengthMm,
                height: parcel.heightMm,
                actualWeight: parcel.weightGrams,
              },
            ],
            sender: {
              countryCode: "UA",
              divisionId: settings.senderDivisionId,
              name: settings.senderName,
              phone: settings.senderPhone,
            },
            recipient: { countryCode: "UA", divisionId: Number(input.destination.pickupPointRef) },
          },
          maxBytes: NOVA_POST_SIZE_CAPS.small,
          timeoutMs: SHIPPING_PROVIDER_TIMEOUTS_MS.estimate,
          retryOn401: true,
        },
        signal,
      );
      if (answer.status !== 200 && answer.status !== 201) {
        return failureOf(answer);
      }
      const parsed = calculationAnswerSchema.safeParse(answer.json);
      if (!parsed.success) {
        return providerFailure("unavailable", ["malformed_answer"]);
      }
      if (parsed.data.services.length === 0) {
        return providerFailure("rejected", ["no_price"]);
      }
      let amount = 0;
      for (const service of parsed.data.services) {
        const minor = hryvniasToMinor(service.cost);
        if (minor === undefined) {
          return providerFailure("rejected", ["invalid_amount"]);
        }
        amount += minor;
      }
      return providerOk({ amount, currency: "UAH" });
    } catch (error) {
      return caught(error);
    }
  }

  async createWaybill(
    input: WaybillRequest,
    signal: AbortSignal,
  ): Promise<ProviderResult<WaybillCreated>> {
    const operation = "createWaybill";
    const settings = parseNovaPostSettings(input.settings);
    if (settings === undefined) {
      return providerFailure("rejected", ["settings_invalid"]);
    }
    if (input.destination.kind !== "pickup_point") {
      // Delivery to an address (`addressParts`) is not verified: not offered in v1.
      return providerFailure("not_supported", ["destination_kind"]);
    }
    if (input.declaredValue.currency !== "UAH") {
      return providerFailure("not_supported", ["currency"]);
    }
    if (!DIGITS_REF.test(input.destination.pickupPointRef)) {
      return providerFailure("rejected", ["invalid_pickup_point"]);
    }
    const phone = novaPostPhone(input.recipient.phone);
    if (phone === undefined) {
      return providerFailure("rejected", ["recipient_phone"]);
    }
    const name = `${input.recipient.firstName.trim()} ${input.recipient.lastName.trim()}`.trim();
    // Two words at least: the carrier refused a one-word contact (H18, "Contact Sender contains less than 2 words";
    // the same rule for the recipient is assumed). Refused here, before a create whose 422 could not be read as a refusal.
    if (name.split(/\s+/).length < 2 || [...name].length > 100) {
      return providerFailure("rejected", ["recipient_name"]);
    }
    const description = cut(input.description, 100);
    const body: Record<string, unknown> = {
      status: "ReadyToShip",
      clientOrder: input.clientReference,
      note: description,
      payerType: input.payer === "sender" ? "Sender" : "Recipient",
      parcels: [
        {
          cargoCategory: "parcel",
          parcelDescription: description,
          insuranceCost: wholeHryvnias(input.declaredValue),
          rowNumber: 1,
          width: input.parcel.widthMm,
          length: input.parcel.lengthMm,
          height: input.parcel.heightMm,
          actualWeight: input.parcel.weightGrams,
        },
      ],
      sender: {
        companyTin: settings.senderCompanyTin ?? "",
        companyName: settings.senderCompanyName ?? "",
        phone: settings.senderPhone,
        email: settings.senderEmail ?? "",
        name: settings.senderName,
        countryCode: "UA",
        divisionId: settings.senderDivisionId,
        addressParts: {},
      },
      recipient: {
        companyTin: "",
        companyName: "",
        phone,
        email: "",
        name,
        countryCode: "UA",
        divisionId: Number(input.destination.pickupPointRef),
        addressParts: {},
      },
    };
    if (input.payer === "sender" && settings.payerContractNumber !== undefined) {
      body.payerContractNumber = settings.payerContractNumber;
    }
    try {
      // The JWT first, on its own: when the authorization fails, provably no create left, so the API may settle the
      // shipment `failed` instead of `unknown` (nothing to reconcile; review finding 8).
      await this.http.jwt(signal, operation);
    } catch (error) {
      if (error instanceof NovaPostCallError) {
        return providerFailure(error.reason, [
          ...error.codes.slice(0, MAX_PROVIDER_CODES - 1),
          PROVIDER_CODE_NOT_SENT,
        ]);
      }
      throw error;
    }
    try {
      const answer = await this.http.request(
        {
          operation,
          method: "POST",
          path: "/shipments",
          body,
          maxBytes: NOVA_POST_SIZE_CAPS.small,
          timeoutMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
          // Never repeated: a second POST makes a second shipment (H22).
          retryOn401: false,
        },
        signal,
      );
      if (answer.status === 422 && !namesRequestField(answer.json)) {
        // A 422 that names no field of ours: production dresses server errors so (H27). The shipment may exist.
        return providerFailure("unavailable", carrierCodesOf(answer.status, answer.json));
      }
      if (answer.status !== 200 && answer.status !== 201) {
        return failureOf(answer);
      }
      const parsed = createdShipmentSchema.safeParse(answer.json);
      if (
        !parsed.success ||
        !CARRIER_REFERENCE_PATTERN.test(parsed.data.id) ||
        !CARRIER_REFERENCE_PATTERN.test(parsed.data.number)
      ) {
        // A 2xx we cannot read: the shipment may exist, so this is "unknown" for the API, never "failed".
        return providerFailure("unavailable", ["malformed_answer"]);
      }
      return providerOk(
        this.waybillOf(
          parsed.data.id,
          parsed.data.number,
          parsed.data.cost,
          parsed.data.scheduledDeliveryDate,
        ),
      );
    } catch (error) {
      return caught(error);
    }
  }

  async findWaybill(
    input: WaybillLookup,
    signal: AbortSignal,
  ): Promise<ProviderResult<WaybillCreated | null>> {
    const operation = "findWaybill";
    const after = Date.parse(input.createdAfter);
    const before = Date.parse(input.createdBefore);
    if (!Number.isFinite(after) || !Number.isFinite(before) || !(after < before)) {
      return providerFailure("rejected", ["invalid_window"]);
    }
    const matches = new Map<string, WaybillCreated>();
    const seen = new Set<string>();
    let shape: { readonly total: number | undefined; readonly lastPage: number } | undefined;
    let certain = false;
    try {
      for (let page = 1; page <= NOVA_POST_FIND_MAX_PAGES; page += 1) {
        const answer = await this.http.request(
          {
            operation,
            method: "GET",
            path: "/shipments",
            query: { limit: NOVA_POST_PAGE_LIMIT, page },
            maxBytes: NOVA_POST_SIZE_CAPS.shipments,
            timeoutMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
            retryOn401: true,
          },
          signal,
        );
        if (answer.status !== 200) {
          return failureOf(answer);
        }
        const envelope = pageSchema.safeParse(answer.json);
        if (!envelope.success) {
          return providerFailure("unavailable", ["malformed_answer"]);
        }
        // Offset paging over a live list (review finding 1): a shipment deleted or created while the pages are read
        // moves every later row, so a row can slip onto a page already read. A changed `total` or `last_page`, another
        // page than asked for, or a row seen twice means the scan cannot be sure: no answer, never `null`.
        const current = { total: envelope.data.total, lastPage: envelope.data.last_page };
        shape ??= current;
        if (
          envelope.data.current_page !== page ||
          current.total !== shape.total ||
          current.lastPage !== shape.lastPage
        ) {
          return providerFailure("unavailable", ["list_changed"]);
        }
        const times: number[] = [];
        for (const item of envelope.data.items) {
          const row = shipmentRowSchema.safeParse(item);
          if (!row.success) {
            // One unreadable row could be ours: the scan cannot be sure, so it is no answer at all.
            return providerFailure("unavailable", ["malformed_answer"]);
          }
          if (seen.has(row.data.id)) {
            return providerFailure("unavailable", ["list_changed"]);
          }
          seen.add(row.data.id);
          const at = Date.parse(row.data.createdAt);
          times.push(at);
          if (row.data.clientOrder === input.clientReference && at >= after && at <= before) {
            matches.set(
              row.data.id,
              this.waybillOf(
                row.data.id,
                row.data.number,
                row.data.totalCost,
                row.data.scheduledDeliveryDate,
              ),
            );
          }
        }
        const newestFirst = times.every(
          (time, index) => index === 0 || time <= (times[index - 1] ?? time),
        );
        const oldest = Math.min(...times);
        if (
          page >= envelope.data.last_page ||
          times.length === 0 ||
          // Newest first (H23): every later page is older than this page's oldest row, so older than the window.
          (newestFirst && oldest < after)
        ) {
          certain = true;
          break;
        }
      }
    } catch (error) {
      return caught(error);
    }
    if (!certain) {
      return providerFailure("unavailable", ["scan_limit"]);
    }
    if (matches.size > 1) {
      // A repeated create made two shipments with our reference (H22): an admin decides in the cabinet.
      return providerFailure("rejected", ["ambiguous_reference"]);
    }
    return providerOk([...matches.values()][0] ?? null);
  }

  async cancelWaybill(
    input: { readonly providerRef: string },
    signal: AbortSignal,
  ): Promise<ProviderResult<void>> {
    if (!UUID.test(input.providerRef)) {
      // Ukraine deletes by the shipment's uuid only (H28).
      return providerFailure("rejected", ["invalid_reference"]);
    }
    try {
      const answer = await this.http.request(
        {
          operation: "cancelWaybill",
          method: "DELETE",
          path: `/shipments/${input.providerRef}`,
          maxBytes: NOVA_POST_SIZE_CAPS.small,
          timeoutMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
          retryOn401: true,
        },
        signal,
      );
      // A repeat answers 422 shipment_was_deleted (H29): the waybill is gone either way.
      if (
        answer.status === 200 ||
        answer.status === 204 ||
        (answer.status === 422 && hasCarrierCode(answer.json, "shipment_was_deleted"))
      ) {
        return providerOk(undefined);
      }
      return failureOf(answer);
    } catch (error) {
      return caught(error);
    }
  }

  /** `phones` are ignored: Nova Post tracks by number only. */
  async track(
    input: { readonly trackingNumbers: readonly string[]; readonly phones: readonly string[] },
    signal: AbortSignal,
  ): Promise<ProviderResult<TrackingUpdate[]>> {
    const requested = new Set(
      input.trackingNumbers
        .filter((number) => TRACKING_NUMBER.test(number))
        .slice(0, SHIPPING_LIMITS.maxTrackingNumbersPerCall),
    );
    if (requested.size === 0) {
      signal.throwIfAborted();
      return providerOk([]);
    }
    try {
      const answer = await this.http.request(
        {
          operation: "track",
          method: "GET",
          path: "/shipments/tracking",
          query: { numbers: [...requested] },
          maxBytes: NOVA_POST_SIZE_CAPS.tracking,
          timeoutMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
          retryOn401: true,
        },
        signal,
      );
      if (answer.status === 404) {
        // "Shipments not found": the carrier knows none of the numbers.
        return providerOk([]);
      }
      if (answer.status !== 200) {
        return failureOf(answer);
      }
      // Production's shape first (spike 7a rerun, H25), then the documented one.
      const observed = trackingItemsSchema.safeParse(answer.json);
      const documented = observed.success
        ? undefined
        : trackingDocumentedSchema.safeParse(answer.json);
      let rows: StatusRow[];
      if (observed.success) {
        rows = observed.data.items.flatMap((item) => {
          const current = item.currentStatus;
          if (current === null || current === undefined) {
            return [];
          }
          return Array.isArray(current) ? current.slice(0, 1) : [current];
        });
      } else if (documented?.success === true) {
        rows = documented.data.currentStatus;
      } else {
        return providerFailure("unavailable", ["malformed_answer"]);
      }
      const updates = new Map<string, TrackingUpdate>();
      for (const row of rows) {
        if (!requested.has(row.number) || updates.has(row.number)) {
          continue;
        }
        const code = String(row.statusCode);
        const at = typeof row.statusDate === "string" ? Date.parse(row.statusDate) : Number.NaN;
        updates.set(row.number, {
          trackingNumber: row.number,
          status: mapNovaPostStatus(code),
          carrierStatusCode: code,
          carrierStatusAt: Number.isFinite(at) ? new Date(at) : null,
        });
      }
      return providerOk([...updates.values()]);
    } catch (error) {
      return caught(error);
    }
  }

  /** Best effort: production answered 422 "Internal Server Error" for the documented request (rerun, H27). */
  async fetchLabel(
    input: {
      readonly providerRef: string;
      readonly trackingNumber: string;
      readonly format: "pdf";
    },
    signal: AbortSignal,
  ): Promise<ProviderResult<{ bytes: Uint8Array; contentType: "application/pdf" }>> {
    if (!TRACKING_NUMBER.test(input.trackingNumber)) {
      return providerFailure("rejected", ["invalid_number"]);
    }
    try {
      const answer = await this.http.request(
        {
          operation: "fetchLabel",
          method: "GET",
          path: "/shipments/print",
          // `type=marking`, not `type[]=marking` (production: "The type field must be a string."); one number per request.
          query: { numbers: [input.trackingNumber], type: "marking" },
          accept: "application/pdf, application/json",
          maxBytes: NOVA_POST_SIZE_CAPS.label,
          timeoutMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
          retryOn401: true,
        },
        signal,
      );
      if (answer.status === 200) {
        const isPdf =
          answer.contentType.toLowerCase().startsWith("application/pdf") &&
          PDF_MAGIC.every((byte, index) => answer.bytes[index] === byte);
        return isPdf
          ? providerOk({ bytes: answer.bytes, contentType: "application/pdf" as const })
          : providerFailure("unavailable", ["not_pdf"]);
      }
      if (answer.status === 422 && !namesRequestField(answer.json)) {
        // A server error dressed as 422 (H27): try again later. A 422 naming a field of ours is a refusal (below).
        return providerFailure("unavailable", carrierCodesOf(answer.status, answer.json));
      }
      return failureOf(answer);
    } catch (error) {
      return caught(error);
    }
  }

  /** A fresh JWT (the key itself is checked, not a cached token), then one authenticated read. */
  async checkConnection(signal: AbortSignal): Promise<ProviderResult<void>> {
    const operation = "checkConnection";
    try {
      await this.http.jwt(signal, operation, true);
      const answer = await this.http.request(
        this.lookup(operation, "/divisions", NOVA_POST_SIZE_CAPS.divisions, {
          query: { countryCodes: ["UA"], limit: 1 },
        }),
        signal,
      );
      return answer.status === 200 ? providerOk(undefined) : failureOf(answer);
    } catch (error) {
      return caught(error);
    }
  }

  private lookup(
    operation: string,
    path: string,
    maxBytes: number,
    extra: Pick<RequestSpec, "query" | "language">,
  ): RequestSpec {
    return {
      operation,
      method: "GET",
      path,
      ...extra,
      maxBytes,
      timeoutMs: SHIPPING_PROVIDER_TIMEOUTS_MS.lookup,
      retryOn401: true,
    };
  }

  /** The page envelope of a lookup answer; any other status or shape throws (lookups throw on failure). */
  private page(operation: string, answer: Answer) {
    if (answer.status !== 200) {
      const failure = failureOf(answer);
      throw new NovaPostCallError(
        operation,
        failure.ok ? "unavailable" : failure.reason,
        failure.ok ? [] : failure.providerCodes,
      );
    }
    const parsed = pageSchema.safeParse(answer.json);
    if (!parsed.success) {
      throw malformed(operation);
    }
    return parsed.data;
  }

  private kindOf(division: Division): PickupPointKind | undefined {
    for (const kind of ["branch", "locker"] as const) {
      if (NOVA_POST_CATEGORIES[kind].includes(division.divisionCategory)) {
        return kind;
      }
    }
    return undefined;
  }

  private pointOf(division: Division, kind: PickupPointKind): PickupPoint {
    const address = division.address?.trim() ?? "";
    const weight = division.maxWeightPlaceRecipient;
    return {
      ref: String(division.id),
      number: cut(division.number, DESCRIPTION_MAX),
      kind,
      cityRef: String(division.settlement.id),
      cityName: cut(division.settlement.name, DESCRIPTION_MAX),
      countryCode: division.countryCode,
      description: cut(
        address === "" ? division.name : `${division.name.trim()}, ${address}`,
        DESCRIPTION_MAX,
      ),
      maxWeightGrams: Number.isSafeInteger(weight) && (weight ?? 0) > 0 ? (weight as number) : null,
    };
  }

  /** Points of one kind from a page: well-formed, of the city, issuing to recipients, of a known category. */
  private collect(
    items: readonly unknown[],
    kind: PickupPointKind,
    cityRef: string,
    into: Map<string, PickupPoint>,
  ): void {
    let dropped = 0;
    for (const item of items) {
      const parsed = divisionSchema.safeParse(item);
      if (
        !parsed.success ||
        String(parsed.data.settlement.id) !== cityRef ||
        this.kindOf(parsed.data) !== kind ||
        !/^[A-Z]{2}$/.test(parsed.data.countryCode)
      ) {
        dropped += 1;
        continue;
      }
      if (parsed.data.prohibitedIssuance === true) {
        continue;
      }
      into.set(String(parsed.data.id), this.pointOf(parsed.data, kind));
    }
    this.dropped("listPickupPoints", dropped);
  }

  private dropped(operation: string, count: number): void {
    if (count > 0) {
      this.logger.warn(
        `${operation}: ${String(count)} answer entries break the expected shape; dropped`,
      );
    }
  }

  private waybillOf(
    id: string,
    number: string,
    cost: number | null | undefined,
    scheduled: string | null | undefined,
  ): WaybillCreated {
    const minor = typeof cost === "number" ? hryvniasToMinor(cost) : undefined;
    return {
      providerRef: id,
      trackingNumber: number,
      carrierCost: minor === undefined ? null : { amount: minor, currency: "UAH" },
      estimatedDeliveryDate: kyivDate(scheduled),
    };
  }
}

import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CARRIER_REFERENCE_PATTERN,
  createMoney,
  decideShipmentTransition,
  isTrackedShipmentStatus,
  MAX_AMOUNT,
  PROVIDER_CODE_NOT_SENT,
  SHIPPING_LIMITS,
  type Money,
  type ProviderFailureReason,
  type ShipmentPayer,
  type ShipmentStatus,
  type ShippingCapability,
  type ShippingDestination,
  type ShippingProviderPort,
  type WaybillCreated,
  type WaybillLookup,
  type WaybillRequest,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { retryOnDeadlock } from "../../common/deadlock-retry.js";
import { isUniqueViolation } from "../../common/postgres-errors.js";
import {
  notFound,
  ProblemException,
  ruleViolation,
  shippingProviderUnavailable,
  validationFailed,
} from "../../common/problem.js";
import { withTransaction, type DbExecutor, type Transaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { parseAddress } from "../../orders/order-view.js";
import {
  OrdersRepository,
  type OrderRow,
  type ShipmentRow,
} from "../../orders/orders.repository.js";
import { orderPickupPointSchema } from "../../orders/orders.schemas.js";
import { OrdersService } from "../../orders/orders.service.js";
import { ShippingProviderRegistry } from "../registry/shipping-provider-registry.js";
import {
  SHIPMENT_CALL_TIMEOUTS,
  type ShipmentCallTimeouts,
} from "../registry/provider-timeouts.js";
import { callProvider, describeOutcome, type ProviderCallOutcome } from "./provider-call.js";
import { ShipmentChanges, type ShipmentActorRef } from "./shipment-changes.js";
import { ShipmentTrackingService } from "./shipment-tracking.service.js";
import { shipmentStatusOf, toAdminShipment, type AdminShipmentView } from "./shipment-view.js";
import type {
  CreateShipmentBody,
  CreateShipmentResult,
  ShipmentList,
} from "./shipments.schemas.js";
import { ShipmentsRepository } from "./shipments.repository.js";
import { nextPollAfterAnswer, nextTrackAtOf } from "./tracking-schedule.js";

/** `Retry-After` of a `503 shipping_provider_unavailable` from a shipment route. */
export const SHIPMENT_RETRY_AFTER_SECONDS = 30;

/** A `pending` row older than this was left by a crash between the two transactions of a create: reconcile may settle it. */
export const STALE_PENDING_MS = 2 * 60_000;

/**
 * How far `findWaybill`'s window reaches past our own times on both sides (review M-2): before the shipment row's
 * `created_at` (clock skew between us and the carrier) and after the lookup (a save the carrier finished late).
 */
export const FIND_WAYBILL_MARGIN_MS = 5 * 60_000;

/**
 * The youngest an `unknown` or `pending` shipment may be for a "not found" of `reconcile` to make it `failed` (review M-2).
 * A carrier's list may lag right after a timed-out save; `failed` re-allows a create, so settling a young one on a negative
 * answer risks a duplicate waybill. A younger one answers `409 reconcile_too_early` and stays as it is; a FOUND waybill
 * settles at any age.
 */
export const RECONCILE_NOT_FOUND_MIN_AGE_MS = 5 * 60_000;

/** The largest label the API passes on (a carrier label is a page or two). */
export const LABEL_MAX_BYTES = 10 * 1024 * 1024;

/** Statuses whose waybill has a printable label. */
const LABEL_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  "created",
  "in_transit",
  "arrived",
  "delivered",
  "returning",
  "returned",
]);

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export interface ShipmentLabel {
  readonly bytes: Uint8Array;
  readonly filename: string;
}

/** The answer of a create or reconcile split into what may be stored; `undefined` refs mean the answer broke the port. */
interface CheckedWaybill {
  readonly providerRef: string;
  readonly trackingNumber: string;
  /** `null` also when the carrier's cost was malformed or in another currency (logged; the waybill is still stored). */
  readonly carrierCostAmount: number | null;
}

/**
 * The shipment routes of an order (ADR 0029 decision 10, plan step 8): create, reconcile, cancel, refresh, label, list.
 *
 * - Every carrier call runs OUTSIDE any database transaction and lock, with the API's time limit
 *   (`SHIPMENT_CALL_TIMEOUTS`). A create first commits the `pending` row (under the order lock, after the checks), then
 *   asks the carrier, then records the answer in a second short transaction that locks the shipment row only.
 * - A lost answer (timeout, network failure, a thrown error, an answer that breaks the port, `unavailable` without the
 *   provider's proof `not_sent`) makes the shipment `unknown`;
 *   the admin settles it with `reconcile`, which asks the carrier for the waybill by our order number (`findWaybill`).
 *   Nothing here retries a carrier write.
 * - Status changes go through `ShipmentChanges` only. The order itself never changes here: fulfilment stays manual.
 * - Logs carry ids, the operation, the outcome kind, the typed reason and carrier codes only: never a name, a phone, a
 *   key or a carrier's message.
 */
@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger("Shipments");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(OrdersService) private readonly orderService: OrdersService,
    @Inject(ShipmentsRepository) private readonly shipments: ShipmentsRepository,
    @Inject(ShipmentChanges) private readonly changes: ShipmentChanges,
    @Inject(ShipmentTrackingService) private readonly tracking: ShipmentTrackingService,
    @Inject(ShippingProviderRegistry) private readonly registry: ShippingProviderRegistry,
    @Inject(SHIPMENT_CALL_TIMEOUTS) private readonly timeouts: ShipmentCallTimeouts,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(orderId: string): Promise<ShipmentList> {
    if ((await this.orders.findById(this.database, orderId)) === undefined) {
      throw notFound("Order");
    }
    const rows = await this.orders.listShipments(this.database, [orderId]);
    const changes = await this.orders.listShipmentStatusChanges(
      this.database,
      rows.map((row) => row.id),
    );
    return { items: rows.map((row) => toAdminShipment(row, changes)) };
  }

  async create(
    orderId: string,
    adminId: string,
    body: CreateShipmentBody,
  ): Promise<CreateShipmentResult> {
    const actor: ShipmentActorRef = { type: "admin", adminId };
    const now = this.clock.now();
    let prepared: { row: ShipmentRow; request: WaybillRequest; provider: ShippingProviderPort };
    try {
      prepared = await this.inTransaction((tx) => this.prepare(tx, orderId, actor, body, now));
    } catch (error) {
      if (isUniqueViolation(error, "shipment_order_id_active_key")) {
        throw activeShipmentExists();
      }
      throw error;
    }
    const { row, request, provider } = prepared;

    // The pending row is committed: from here on nothing is locked while the carrier is asked.
    const outcome = await callProvider(this.timeouts.waybillMs, (signal) =>
      provider.createWaybill(request, signal),
    );
    const waybill =
      outcome.kind === "ok" ? this.checkWaybill(row, outcome.value, "createWaybill") : undefined;
    let to: ShipmentStatus;
    let failure: CreateShipmentResult["failure"] = null;
    if (waybill !== undefined) {
      to = "created";
    } else if (
      outcome.kind === "failed" &&
      (outcome.reason !== "unavailable" || outcome.providerCodes.includes(PROVIDER_CODE_NOT_SENT))
    ) {
      // The carrier refused, or the provider proves the request never left (`not_sent`): no waybill exists.
      to = "failed";
      failure = { reason: outcome.reason, providerCodes: [...outcome.providerCodes] };
    } else {
      // Timeout, network failure, a thrown error, or an answer that breaks the port: a waybill may exist.
      to = "unknown";
    }
    if (outcome.kind !== "ok" || waybill === undefined) {
      this.logger.warn(
        `Shipment ${row.id} createWaybill: ${outcome.kind === "ok" ? "answer breaks the port" : describeOutcome(outcome)}; now ${to}`,
      );
    }
    const settled = await this.settle(row.id, ["pending"], to, actor, waybill, now);
    return { shipment: await this.view(this.database, settled), failure };
  }

  async reconcile(
    orderId: string,
    shipmentId: string,
    adminId: string,
  ): Promise<AdminShipmentView> {
    const actor: ShipmentActorRef = { type: "admin", adminId };
    const now = this.clock.now();
    const row = await this.requireShipment(orderId, shipmentId);
    const status = shipmentStatusOf(row.status);
    const stalePending =
      status === "pending" && now.getTime() - row.createdAt.getTime() >= STALE_PENDING_MS;
    if (status !== "unknown" && !stalePending) {
      throw ruleViolation(
        "Only a shipment whose result is unknown can be checked with the carrier.",
        "shipment_not_unknown",
      );
    }
    const provider = this.requireProvider(row.providerCode, "waybills");
    const lookup: WaybillLookup = {
      clientReference: row.clientReference,
      createdAfter: new Date(row.createdAt.getTime() - FIND_WAYBILL_MARGIN_MS).toISOString(),
      createdBefore: new Date(now.getTime() + FIND_WAYBILL_MARGIN_MS).toISOString(),
    };
    const outcome = await callProvider(this.timeouts.waybillMs, (signal) =>
      provider.findWaybill(lookup, signal),
    );
    if (outcome.kind !== "ok") {
      this.logger.warn(`Shipment ${row.id} findWaybill: ${describeOutcome(outcome)}`);
      throw providerProblem(outcome);
    }
    let waybill: CheckedWaybill | undefined;
    if (outcome.value !== null) {
      waybill = this.checkWaybill(row, outcome.value, "findWaybill");
      if (waybill === undefined) {
        this.logger.warn(`Shipment ${row.id} findWaybill: answer breaks the port`);
        throw shipmentProviderUnavailable();
      }
    }
    const age = now.getTime() - row.createdAt.getTime();
    if (waybill === undefined && age < RECONCILE_NOT_FOUND_MIN_AGE_MS) {
      this.logger.warn(
        `Shipment ${row.id} findWaybill: not found yet; too young to settle as failed`,
      );
      throw reconcileTooEarly(RECONCILE_NOT_FOUND_MIN_AGE_MS - age);
    }
    const settled = await this.settle(
      row.id,
      [status],
      waybill === undefined ? "failed" : "created",
      actor,
      waybill,
      now,
    );
    return this.view(this.database, settled);
  }

  async cancel(orderId: string, shipmentId: string, adminId: string): Promise<AdminShipmentView> {
    const actor: ShipmentActorRef = { type: "admin", adminId };
    const row = await this.requireShipment(orderId, shipmentId);
    if (!decideShipmentTransition(shipmentStatusOf(row.status), "cancelled", "admin").ok) {
      throw invalidShipmentTransition();
    }
    const provider = this.requireProvider(row.providerCode, "cancelWaybill");
    if (row.providerRef === null) {
      throw new Error(`Shipment ${row.id} is ${row.status} without a provider ref`);
    }
    const providerRef = row.providerRef;
    const outcome = await callProvider(this.timeouts.waybillMs, (signal) =>
      provider.cancelWaybill({ providerRef }, signal),
    );
    if (outcome.kind !== "ok") {
      this.logger.warn(`Shipment ${row.id} cancelWaybill: ${describeOutcome(outcome)}`);
      throw providerProblem(outcome);
    }
    const now = this.clock.now();
    const cancelled = await this.inTransaction(async (tx) => {
      const locked = await this.shipments.lock(tx, row.id);
      if (locked === undefined) {
        throw notFound("Shipment");
      }
      const result = await this.changes.transition(tx, locked, "cancelled", actor, {
        now,
        columns: { nextTrackAt: null },
      });
      if (!result.ok) {
        // The carrier cancelled the waybill, but tracking moved the shipment on meanwhile: say so loudly.
        this.logger.warn(
          `Shipment ${row.id}: the carrier cancelled the waybill but the shipment is now ${locked.status}`,
        );
        throw invalidShipmentTransition();
      }
      return result.row;
    });
    return this.view(this.database, cancelled);
  }

  async refresh(orderId: string, shipmentId: string, adminId: string): Promise<AdminShipmentView> {
    const row = await this.requireShipment(orderId, shipmentId);
    if (!isTrackedShipmentStatus(shipmentStatusOf(row.status)) || row.trackingNumber === null) {
      throw ruleViolation(
        "Only a shipment with a waybill that is still on its way can be refreshed.",
        "shipment_not_tracked",
      );
    }
    const provider = this.requireProvider(row.providerCode, "tracking");
    const order = await this.orders.findById(this.database, orderId);
    if (order === undefined) {
      throw notFound("Order");
    }
    const trackingNumber = row.trackingNumber;
    const outcome = await this.tracking.poll(provider, [trackingNumber], [recipientPhoneOf(order)]);
    if (outcome.kind !== "ok") {
      this.logger.warn(`Shipment ${row.id} track: ${describeOutcome(outcome)}`);
      throw providerProblem(outcome);
    }
    const applied = await this.tracking.applyAnswer(
      row.id,
      outcome.value.get(trackingNumber),
      { type: "admin", adminId },
      this.clock.now(),
    );
    return this.view(this.database, applied.row ?? row);
  }

  async label(orderId: string, shipmentId: string): Promise<ShipmentLabel> {
    const row = await this.requireShipment(orderId, shipmentId);
    if (
      row.providerRef === null ||
      row.trackingNumber === null ||
      !LABEL_STATUSES.has(shipmentStatusOf(row.status))
    ) {
      throw ruleViolation(
        "This shipment has no waybill to print (not created, failed or cancelled).",
        "label_not_available",
      );
    }
    const provider = this.requireProvider(row.providerCode, "labels");
    // The carrier is told the waybill both ways: Nova Post prints by number, others by their own id (plan step 7b).
    const { providerRef, trackingNumber } = row;
    const outcome = await callProvider(this.timeouts.labelMs, (signal) =>
      provider.fetchLabel({ providerRef, trackingNumber, format: "pdf" }, signal),
    );
    if (outcome.kind !== "ok") {
      this.logger.warn(`Shipment ${row.id} fetchLabel: ${describeOutcome(outcome)}`);
      throw providerProblem(outcome);
    }
    const problem = labelProblem(outcome.value);
    if (problem !== undefined) {
      this.logger.warn(
        `Shipment ${row.id} fetchLabel: the answer is not a usable PDF (${problem})`,
      );
      throw shipmentProviderUnavailable();
    }
    return { bytes: outcome.value.bytes, filename: `label-${row.clientReference}.pdf` };
  }

  /**
   * The first transaction of a create, under the order lock: the order is `paid`, has a carrier that makes waybills, no
   * active shipment, and would pass the mark-fulfilled rule (no line awaiting stock; checked by a rolled-back dry run).
   * Then the `pending` row is written. Commits before any carrier call.
   */
  private async prepare(
    tx: Transaction,
    orderId: string,
    actor: ShipmentActorRef & { type: "admin" },
    body: CreateShipmentBody,
    now: Date,
  ): Promise<{ row: ShipmentRow; request: WaybillRequest; provider: ShippingProviderPort }> {
    const order = await this.orders.lockById(tx, orderId);
    if (order === undefined) {
      throw notFound("Order");
    }
    if (order.status !== "paid") {
      throw orderNotPaid();
    }
    const [snapshot] = await this.orders.listShipping(tx, [order.id]);
    if (snapshot === undefined || snapshot.providerCode === null) {
      throw ruleViolation(
        "The order's shipping method has no carrier, so there is no waybill to create.",
        "no_carrier",
      );
    }
    const provider = this.requireProvider(snapshot.providerCode, "waybills");
    if (body.declaredValue !== undefined && body.declaredValue.currency !== order.currency) {
      throw validationFailed([
        {
          path: "declaredValue.currency",
          code: "currency_mismatch",
          message: "The declared value must be in the order currency.",
        },
      ]);
    }
    if ((await this.shipments.findActive(tx, order.id)) !== undefined) {
      throw activeShipmentExists();
    }
    const fulfilment = await this.orderService.checkFulfilment(
      tx,
      order,
      { type: "admin", adminId: actor.adminId },
      now,
    );
    if (!fulfilment.ok) {
      throw fulfilment.reason === "awaiting_stock"
        ? ruleViolation("A backordered line is not on hand yet.", "awaiting_stock")
        : orderNotPaid();
    }
    const destination = destinationOf(order, snapshot.kind, snapshot.destination);
    const payer: ShipmentPayer =
      body.payer ?? (snapshot.payer === "recipient_on_delivery" ? "recipient" : "sender");
    const declaredValue = body.declaredValue ?? subtotalOf(order);
    const settings = await this.shipments.providerSettings(tx, provider.code);
    const parcel = {
      weightGrams: body.weightGrams,
      lengthMm: body.lengthMm,
      widthMm: body.widthMm,
      heightMm: body.heightMm,
      seats: SHIPPING_LIMITS.seatsPerShipment,
    };
    const row = await this.changes.create(
      tx,
      {
        orderId: order.id,
        providerCode: provider.code,
        providerService: snapshot.providerService,
        clientReference: order.number,
        declaredValueAmount: declaredValue.amount,
        currency: declaredValue.currency,
        payer,
        ...parcel,
        createdBy: actor.adminId,
        createdAt: now,
        updatedAt: now,
      },
      actor,
    );
    const request: WaybillRequest = {
      clientReference: order.number,
      service: snapshot.providerService,
      payer,
      declaredValue,
      parcel,
      description: body.description,
      recipient: recipientOf(order),
      destination,
      settings,
    };
    return { row, request, provider };
  }

  /**
   * The second transaction: locks the shipment and moves it from one of `expected` to `to` (with the waybill's columns for
   * `created`). When something else settled it first (a reconcile racing a slow create), it is left as it is and logged.
   */
  private async settle(
    shipmentId: string,
    expected: readonly ShipmentStatus[],
    to: ShipmentStatus,
    actor: ShipmentActorRef,
    waybill: CheckedWaybill | undefined,
    now: Date,
  ): Promise<ShipmentRow> {
    return this.inTransaction(async (tx) => {
      const locked = await this.shipments.lock(tx, shipmentId);
      if (locked === undefined) {
        throw notFound("Shipment");
      }
      if (!expected.includes(shipmentStatusOf(locked.status))) {
        this.logger.warn(
          `Shipment ${shipmentId}: settled as ${locked.status} meanwhile; the answer for ${to} is not applied`,
        );
        return locked;
      }
      const columns =
        to === "created" && waybill !== undefined
          ? {
              providerRef: waybill.providerRef,
              trackingNumber: waybill.trackingNumber,
              carrierCostAmount: waybill.carrierCostAmount,
              trackingAttempts: 0,
              nextTrackAt: nextTrackAtOf(nextPollAfterAnswer("created", locked.createdAt, now)),
            }
          : {};
      const result = await this.changes.transition(tx, locked, to, actor, { now, columns });
      if (!result.ok) {
        throw new Error(
          `Shipment ${shipmentId}: ${locked.status} -> ${to} refused: ${result.reason}`,
        );
      }
      return result.row;
    });
  }

  /** The storable part of a waybill answer; `undefined` when its refs break the port (nothing of it is stored). */
  private checkWaybill(
    row: ShipmentRow,
    value: WaybillCreated,
    operation: "createWaybill" | "findWaybill",
  ): CheckedWaybill | undefined {
    const candidate = value as Partial<WaybillCreated> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.providerRef !== "string" ||
      !CARRIER_REFERENCE_PATTERN.test(candidate.providerRef) ||
      typeof candidate.trackingNumber !== "string" ||
      !CARRIER_REFERENCE_PATTERN.test(candidate.trackingNumber)
    ) {
      return undefined;
    }
    const cost = candidate.carrierCost;
    let carrierCostAmount: number | null = null;
    if (cost !== null && cost !== undefined) {
      if (
        Number.isSafeInteger(cost.amount) &&
        cost.amount >= 0 &&
        cost.amount <= MAX_AMOUNT &&
        cost.currency === row.currency
      ) {
        carrierCostAmount = cost.amount;
      } else {
        this.logger.warn(
          `Shipment ${row.id} ${operation}: the carrier cost breaks the port; not stored`,
        );
      }
    }
    return {
      providerRef: candidate.providerRef,
      trackingNumber: candidate.trackingNumber,
      carrierCostAmount,
    };
  }

  private async requireShipment(orderId: string, shipmentId: string): Promise<ShipmentRow> {
    const row = await this.shipments.find(this.database, orderId, shipmentId);
    if (row === undefined) {
      throw notFound("Shipment");
    }
    return row;
  }

  /** The loaded provider of the shipment, offering `capability`; a provider switched off since is a 409, not a 500. */
  private requireProvider(code: string, capability: ShippingCapability): ShippingProviderPort {
    const provider = this.registry.get(code);
    if (provider === undefined) {
      throw ruleViolation(
        "The carrier of this order is not enabled in this shop (SHIPPING_PROVIDERS_ENABLED).",
        "provider_not_enabled",
      );
    }
    if (!provider.capabilities[capability]) {
      throw ruleViolation("The carrier does not offer this.", "carrier_not_supported");
    }
    return provider;
  }

  private async view(db: DbExecutor, row: ShipmentRow): Promise<AdminShipmentView> {
    return toAdminShipment(row, await this.orders.listShipmentStatusChanges(db, [row.id]));
  }

  private inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return retryOnDeadlock(
      () => withTransaction(this.database, work),
      (message) => this.logger.warn(message),
    );
  }
}

function subtotalOf(order: OrderRow): Money {
  const subtotal = createMoney(order.subtotalAmount, order.currency);
  if (!subtotal.ok) {
    throw new RangeError(`Order ${order.number} has a subtotal core rejects: ${subtotal.reason}`);
  }
  return subtotal.money;
}

function orderNotPaid(): ProblemException {
  return ruleViolation("Only a paid order can be shipped.", "order_not_paid");
}

function activeShipmentExists(): ProblemException {
  return ruleViolation(
    "The order already has a shipment that is not cancelled or failed (an unknown one may exist at the carrier: reconcile it).",
    "shipment_exists",
  );
}

/** A "not found" too soon after the create (review M-2): nothing changes; ask again after `Retry-After`. */
function reconcileTooEarly(remainingMs: number): ProblemException {
  return new ProblemException({
    code: "rule_violation",
    detail:
      "The carrier does not list this waybill yet, which is normal right after a lost answer. Nothing changed; check again in a few minutes.",
    extensions: { rule: "reconcile_too_early" },
    headers: { "Retry-After": String(Math.max(1, Math.ceil(remainingMs / 1000))) },
  });
}

function invalidShipmentTransition(): ProblemException {
  return ruleViolation("The shipment can not do this in its current status.", "invalid_transition");
}

function shipmentProviderUnavailable(
  reason: ProviderFailureReason = "unavailable",
  providerCodes: readonly string[] = [],
): ProblemException {
  const base = shippingProviderUnavailable(SHIPMENT_RETRY_AFTER_SECONDS);
  return new ProblemException({
    code: base.code,
    detail:
      "The carrier cannot be reached right now or answered something unusable. Nothing changed; try again later.",
    headers: base.headers,
    members: { reason, providerCodes: [...providerCodes] },
  });
}

const REFUSAL_RULES: Readonly<Record<Exclude<ProviderFailureReason, "unavailable">, string>> = {
  rejected: "carrier_rejected",
  invalid_credentials: "carrier_invalid_credentials",
  not_supported: "carrier_not_supported",
};

/** A carrier failure of an admin action: nothing changed. `unavailable` (and no answer) is a 503, a refusal a 409. */
function providerProblem(
  outcome: Exclude<ProviderCallOutcome<unknown>, { kind: "ok" }>,
): ProblemException {
  if (outcome.kind !== "failed" || outcome.reason === "unavailable") {
    return shipmentProviderUnavailable(
      "unavailable",
      outcome.kind === "failed" ? outcome.providerCodes : [],
    );
  }
  return new ProblemException({
    code: "rule_violation",
    detail: "The carrier refused the request. Nothing changed.",
    extensions: { rule: REFUSAL_RULES[outcome.reason] },
    members: { reason: outcome.reason, providerCodes: [...outcome.providerCodes] },
  });
}

/** Why a label answer is not passed on, or `undefined` when it is a PDF within the size cap. */
function labelProblem(value: { bytes: unknown; contentType: unknown }): string | undefined {
  if (value.contentType !== "application/pdf") {
    return "content_type";
  }
  const bytes = value.bytes;
  if (!(bytes instanceof Uint8Array)) {
    return "not_bytes";
  }
  if (bytes.length > LABEL_MAX_BYTES) {
    return "too_large";
  }
  if (PDF_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    return "not_pdf";
  }
  return undefined;
}

/** The recipient the carrier needs: the address's recipient when the shopper gave one, else the order contact. */
function recipientOf(order: OrderRow): WaybillRequest["recipient"] {
  const address = parseAddress(order.shippingAddress);
  return {
    firstName: address?.recipientFirstName ?? order.firstName,
    lastName: address?.recipientLastName ?? order.lastName,
    phone: recipientPhoneOf(order),
  };
}

function recipientPhoneOf(order: OrderRow): string {
  return parseAddress(order.shippingAddress)?.recipientPhone ?? order.phone;
}

function destinationOf(order: OrderRow, kind: string, destination: unknown): ShippingDestination {
  if (kind === "pickup_point") {
    const point = orderPickupPointSchema.parse(destination);
    return { kind: "pickup_point", cityRef: point.cityRef, pickupPointRef: point.providerRef };
  }
  const address = parseAddress(order.shippingAddress);
  if (kind !== "address" || address === null) {
    // A carrier method of kind store_pickup, or an address order without an address: damaged data (CHECKs prevent both).
    throw new Error(`Order ${order.number} has no destination for a waybill (kind ${kind})`);
  }
  return { kind: "address", address };
}

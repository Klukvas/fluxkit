import { Inject, Injectable } from "@nestjs/common";
import {
  assertValidStatus,
  decideCommit,
  decideExpire,
  decideExtend,
  decideRelease,
  decideReserve,
  isVariantSellable,
  type ExtendRefusal,
  type ReservationStatus,
  type StockLevel,
  type StockReservation,
} from "@fluxkit/core";
import { productStatusSchema } from "../../catalog/admin/products/products.schemas.js";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import { withTransaction, type DbExecutor, type Transaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { InventoryRepository, type LevelRow, type LocationRow } from "../inventory.repository.js";
import {
  ReservationsRepository,
  type DueCursor,
  type ReservableVariantRow,
  type ReservationRow,
} from "./reservations.repository.js";

/*
 * The reservation domain service (docs/api/inventory.md, ADR 0011). It has no HTTP route: the checkout plan calls it.
 *
 * There is ONE implementation per rule, in the transaction-scoped operations that take the CALLER's open transaction
 * and never open their own: `reserveMany`, `releaseIn`, `commitIn`, `extend`. The self-transacting methods `reserve`,
 * `release` and `commit` are wrappers that open a transaction and call them; `expireDue` opens one per reservation.
 *
 * Lock order (ADR 0015; the checkout holds the cart row first): product rows `FOR SHARE` by id -> variant rows
 * `FOR SHARE` by id -> `inventory_level` rows `FOR UPDATE` by (variant id, location id) -> reservation rows. Every
 * multi-row pass is sorted, so two callers with crossing variant sets cannot wait for each other. An operation on an
 * existing reservation takes the level row first, then the reservation row. Each operation asks the core decision
 * (`decideReserve`, `decideRelease`, `decideExpire`, `decideCommit`, `decideExtend`) and writes what it says: the
 * level, the reservation, and, for a commit only, the `sale` journal row. Nothing here decides a stock rule, reads the
 * clock, or updates or deletes a journal row. Refusals are returned as typed results (not thrown) so the caller can
 * act on them; bugs and damaged data throw.
 */

/** A reservation as the caller sees it. */
export interface ReservationView {
  id: string;
  variantId: string;
  locationId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
  reference: string | null;
}

export interface ReserveInput {
  variantId: string;
  /** Defaults to the default location. */
  locationId?: string;
  /** A whole number from 1 to `MAX_QUANTITY`. */
  quantity: number;
  /** When the hold ends; `expireDue` releases it after that. The caller chooses it (cart policy), the service never reads the clock. */
  expiresAt: Date;
  reference?: string | null;
}

/**
 * Why `reserve` did not hold anything. `not_tracked` means the variant has no stock to hold: the caller skips the
 * reservation and sells it freely. `variant_not_sellable` means the variant cannot be bought (see `isVariantSellable`).
 * `reserved_out_of_range` means the level would hold more reserved units than the stored limit (`MAX_RESERVED`; only
 * reachable with backorder).
 */
export type ReserveRefusal =
  | "invalid_quantity"
  | "not_tracked"
  | "insufficient_stock"
  | "reserved_out_of_range"
  | "variant_not_found"
  | "variant_not_sellable"
  | "location_not_found";

export type ReserveResult =
  { ok: true; reservation: ReservationView } | { ok: false; reason: ReserveRefusal };

export type ReservationRefusal =
  | "reservation_not_found"
  | "not_active"
  | "already_committed"
  | "level_inconsistent"
  | "invalid_quantity";

export type ReservationResult =
  { ok: true; reservation: ReservationView } | { ok: false; reason: ReservationRefusal };

/** Commit can also fail because backordered units are not on hand yet. */
export type CommitResult =
  | { ok: true; reservation: ReservationView }
  | { ok: false; reason: ReservationRefusal | "insufficient_stock" };

export interface CommitOptions {
  /** The admin user to record on the `sale` movement; must be an existing `admin_user` id. Default none. */
  actorId?: string | null;
  /** Reference of the `sale` movement (an order number). Defaults to the reservation's own reference. */
  reference?: string | null;
}

/** `extend` refuses with the reasons of `decideExtend` (an invalid date is a caller bug and throws instead). */
export type ExtendReservationRefusal =
  Exclude<ExtendRefusal, "invalid_expiry"> | "reservation_not_found";

export type ExtendResult =
  { ok: true; reservation: ReservationView } | { ok: false; reason: ExtendReservationRefusal };

export interface ReserveManyLine {
  variantId: string;
  /** A whole number from 1 to `MAX_QUANTITY`; anything else is refused as `invalid_quantity` for that line. */
  quantity: number;
}

export interface ReserveManyOptions {
  /** When the holds end. The caller chooses it (order expiry plus grace), the service never reads the clock. */
  expiresAt: Date;
  /** Written on every reservation (the order number, so the journal and the sweep can tell whose hold it is). */
  reference: string | null;
}

/**
 * Why a line of `reserveMany` was refused. Like `ReserveRefusal` without `not_tracked` (an untracked line is not
 * refused, it comes back as `untracked`) and without `location_not_found` (`reserveMany` always uses the default
 * location).
 */
export type ReserveManyRefusal = Exclude<ReserveRefusal, "not_tracked" | "location_not_found">;

/** One line of a successful `reserveMany`, in the order the caller sent them. */
export type ReservedLine =
  | { kind: "reserved"; variantId: string; quantity: number; reservation: ReservationView }
  /** The variant does not track stock: nothing is held, it can always be sold. The caller keeps the line. */
  | { kind: "untracked"; variantId: string; quantity: number };

export type ReserveManyResult =
  | { ok: true; lines: ReservedLine[] }
  /** Nothing was written. One entry per refused line, in input order (every refused line is listed). */
  | { ok: false; refusals: { variantId: string; reason: ReserveManyRefusal }[] };

export interface ExpireDueOptions {
  /** At most this many reservations are looked at per call (1 to 10 000, default 500). */
  limit?: number;
  /**
   * Continue after this position: pass the `nextCursor` of the previous call unchanged. Without it the list starts at
   * the oldest due reservation, where a reservation that could not be expired (see `failures`) comes first again.
   */
  after?: ExpireDueCursor;
}

/** Where the previous `expireDue` call stopped. Opaque: copy it from `nextCursor`, do not build it. */
export type ExpireDueCursor = DueCursor;

export interface ExpireDueResult {
  /** Due reservations looked at. */
  scanned: number;
  expired: number;
  /** No longer active or no longer due when the lock was taken (a commit or a release got there first). */
  skipped: number;
  /** Reservations that could not be expired (damaged data); the others were still processed. Never ignore these. */
  failures: { reservationId: string; reason: ReservationRefusal }[];
  /**
   * `null` when this call reached the end of the due list (it looked at fewer than `limit`): stop. Otherwise pass it
   * as `after` to the next call. Looping on this value ends even when damaged reservations sit at the head, because
   * the cursor moves past them.
   */
  nextCursor: ExpireDueCursor | null;
}

export const DEFAULT_EXPIRE_BATCH = 500;
export const MAX_EXPIRE_BATCH = 10_000;

function toView(row: ReservationRow): ReservationView {
  assertValidStatus(row.status);
  return {
    id: row.id,
    variantId: row.variantId,
    locationId: row.locationId,
    quantity: row.quantity,
    status: row.status,
    expiresAt: row.expiresAt,
    reference: row.reference,
  };
}

/** The two facts the core decisions need; an unknown stored status is a damaged database (RangeError). */
function toHeld(row: ReservationRow): StockReservation {
  assertValidStatus(row.status);
  return { quantity: row.quantity, status: row.status };
}

function toLevel(row: LevelRow): StockLevel {
  return { onHand: row.onHand, reserved: row.reserved };
}

function assertValidDate(value: unknown, what: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${what} must be a valid Date`);
  }
}

const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidCursor(cursor: ExpireDueCursor): void {
  if (!CURSOR_TIME.test(cursor.expiresAt) || !UUID.test(cursor.id)) {
    throw new RangeError("after must be the nextCursor of a previous expireDue call");
  }
}

interface LineRequest {
  variantId: string;
  quantity: number;
  /** Defaults to the default location. */
  locationId: string | undefined;
}

type LineOutcome =
  | { kind: "reserved"; reservation: ReservationView }
  | { kind: "untracked" }
  | { kind: "refused"; reason: ReserveRefusal }
  /** Would have been held, but another line was refused and nothing is written. */
  | { kind: "not_reserved" };

interface Candidate {
  index: number;
  line: LineRequest;
  variant: ReservableVariantRow;
  flags: { trackInventory: boolean; allowBackorder: boolean };
  locationId: string;
}

/** Thrown inside the savepoint of `reserveLines` to undo it when a line is refused; never leaves the service. */
class HoldRefused extends Error {}

function hasRefusal(outcomes: readonly LineOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.kind === "refused");
}

/** Plain code-unit order: for the lower-case hex uuids of the database it is the order Postgres sorts them in. */
function compareText(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Looks each location up once per call (reads only; location rows are never locked). */
class LocationCache {
  private defaultLocation: LocationRow | undefined;
  private readonly byId = new Map<string, LocationRow | undefined>();

  constructor(
    private readonly inventory: InventoryRepository,
    private readonly tx: Transaction,
  ) {}

  async get(locationId: string | undefined): Promise<LocationRow | undefined> {
    if (locationId === undefined) {
      this.defaultLocation ??= await this.inventory.findDefaultLocation(this.tx);
      if (this.defaultLocation === undefined) {
        throw new Error("There is no default location; the migration creates one named main.");
      }
      return this.defaultLocation;
    }
    if (!this.byId.has(locationId)) {
      this.byId.set(locationId, await this.inventory.findLocation(this.tx, locationId));
    }
    return this.byId.get(locationId);
  }
}

@Injectable()
export class ReservationsService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly reservations: ReservationsRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  /**
   * Holds `quantity` units of a variant at a location in its own transaction (a wrapper of the logic `reserveMany`
   * uses). Refuses (writing nothing) when the quantity is not usable, the variant is not tracked, inactive or in an
   * unpublished product, or the available units do not cover it. With `allow_backorder` it holds beyond `on_hand`.
   * The first reservation of a backordered variant creates its level row.
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    assertValidDate(input.expiresAt, "expiresAt");
    return withTransaction(this.database, async (tx) => {
      const [outcome] = await this.reserveLines(
        tx,
        [{ variantId: input.variantId, quantity: input.quantity, locationId: input.locationId }],
        { expiresAt: input.expiresAt, reference: input.reference ?? null },
      );
      switch (outcome?.kind) {
        case "reserved":
          return { ok: true, reservation: outcome.reservation };
        case "untracked":
          return { ok: false, reason: "not_tracked" };
        case "refused":
          return { ok: false, reason: outcome.reason };
        default:
          throw new Error("A single reservation line came back without an outcome.");
      }
    });
  }

  /**
   * Holds several variants at once at the default location, inside the CALLER's transaction (the checkout), all or
   * nothing. Every line is evaluated with the core decisions against the locked rows BEFORE anything is written; if
   * any line is refused nothing is written (not even an empty level row) and every refused line is returned. Otherwise
   * each tracked line gets one reservation (`reference` and `expiresAt` from `options`) and its level is updated;
   * untracked lines come back as `untracked` without a row. Lines come back in input order. A variant may appear once
   * (a duplicate, an empty list or an invalid date is a caller bug: `RangeError`, nothing written). Locks: product rows
   * `FOR SHARE`, variant rows `FOR SHARE`, then level rows `FOR UPDATE`, each pass in id order (see the header).
   */
  async reserveMany(
    tx: Transaction,
    lines: readonly ReserveManyLine[],
    options: ReserveManyOptions,
  ): Promise<ReserveManyResult> {
    assertValidDate(options.expiresAt, "expiresAt");
    if (lines.length === 0) {
      throw new RangeError("reserveMany needs at least one line");
    }
    const seen = new Set<string>();
    for (const line of lines) {
      const key = line.variantId.toLowerCase();
      if (seen.has(key)) {
        throw new RangeError(`reserveMany got the variant ${line.variantId} more than once`);
      }
      seen.add(key);
    }

    const outcomes = await this.reserveLines(
      tx,
      lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        locationId: undefined,
      })),
      options,
    );
    const refusals: { variantId: string; reason: ReserveManyRefusal }[] = [];
    const reserved: ReservedLine[] = [];
    for (const [index, line] of lines.entries()) {
      const outcome = outcomes[index];
      if (outcome === undefined) {
        throw new Error("A reservation line came back without an outcome.");
      }
      if (outcome.kind === "refused") {
        if (outcome.reason === "not_tracked" || outcome.reason === "location_not_found") {
          throw new Error(`reserveMany can not be refused with ${outcome.reason}.`);
        }
        refusals.push({ variantId: line.variantId, reason: outcome.reason });
      } else if (outcome.kind === "reserved") {
        reserved.push({
          kind: "reserved",
          variantId: line.variantId,
          quantity: line.quantity,
          reservation: outcome.reservation,
        });
      } else if (outcome.kind === "untracked") {
        reserved.push({ kind: "untracked", variantId: line.variantId, quantity: line.quantity });
      }
    }
    return refusals.length > 0 ? { ok: false, refusals } : { ok: true, lines: reserved };
  }

  /** Gives the held units back (a cancelled cart or order) in its own transaction. See `releaseIn`. */
  async release(reservationId: string): Promise<ReservationResult> {
    return withTransaction(this.database, (tx) => this.releaseIn(tx, reservationId));
  }

  /** Lowers `reserved`, status `released`, writes no journal row; in the caller's transaction. */
  async releaseIn(tx: Transaction, reservationId: string): Promise<ReservationResult> {
    const locked = await this.lockPair(tx, reservationId);
    if (locked === undefined) {
      return { ok: false, reason: "reservation_not_found" };
    }
    const decision = decideRelease(toLevel(locked.level), toHeld(locked.reservation));
    if (!decision.ok) {
      return { ok: false, reason: decision.reason };
    }
    return this.apply(tx, locked.reservation, decision.level, "released");
  }

  /** Turns an active reservation into a sale in its own transaction. See `commitIn`. */
  async commit(reservationId: string, options: CommitOptions = {}): Promise<CommitResult> {
    return withTransaction(this.database, (tx) => this.commitIn(tx, reservationId, options));
  }

  /**
   * Turns an active reservation into a sale in the caller's transaction: lowers `on_hand` and `reserved` and appends
   * the `sale` movement. The expiry time is not checked: a reservation that is overdue but not yet swept by
   * `expireDue` can still be sold (the customer paid); after the sweep it answers `not_active`. Backordered units that
   * are not on hand yet answer `insufficient_stock` and the reservation stays active.
   */
  async commitIn(
    tx: Transaction,
    reservationId: string,
    options: CommitOptions = {},
  ): Promise<CommitResult> {
    const locked = await this.lockPair(tx, reservationId);
    if (locked === undefined) {
      return { ok: false, reason: "reservation_not_found" };
    }
    const decision = decideCommit(toLevel(locked.level), toHeld(locked.reservation));
    if (!decision.ok) {
      return { ok: false, reason: decision.reason };
    }
    const result = await this.apply(tx, locked.reservation, decision.level, "committed");
    await this.inventory.insertMovement(tx, {
      variantId: locked.reservation.variantId,
      locationId: locked.reservation.locationId,
      delta: decision.movement.delta,
      kind: decision.movement.kind,
      onHandAfter: decision.movement.onHandAfter,
      reason: null,
      reference: options.reference ?? locked.reservation.reference,
      actorId: options.actorId ?? null,
    });
    return result;
  }

  /**
   * Moves the expiry of an ACTIVE reservation later, in the caller's transaction (a paid order's backordered line is
   * held until stock arrives). Takes the level and reservation locks like every operation on an existing reservation,
   * so it is mutually exclusive with commit, release and expiry: the one that locks first wins, and an extend that
   * comes after the sweep expired the reservation answers `not_active`. Core `decideExtend`: never shortens
   * (`would_shorten`), the same time again is accepted. Changes `expires_at` only: no level or journal write. Like
   * `commit` it does not look at the clock, so an overdue reservation that has not been swept yet can still be
   * extended. An invalid date throws `RangeError`.
   */
  async extend(tx: Transaction, reservationId: string, expiresAt: Date): Promise<ExtendResult> {
    assertValidDate(expiresAt, "expiresAt");
    const locked = await this.lockPair(tx, reservationId);
    if (locked === undefined) {
      return { ok: false, reason: "reservation_not_found" };
    }
    assertValidStatus(locked.reservation.status);
    const decision = decideExtend(
      { status: locked.reservation.status, expiresAt: locked.reservation.expiresAt },
      expiresAt,
    );
    if (!decision.ok) {
      if (decision.reason === "invalid_expiry") {
        throw new RangeError("expiresAt must be a valid Date");
      }
      return { ok: false, reason: decision.reason };
    }
    const updated = await this.reservations.setExpiresAt(tx, reservationId, decision.expiresAt);
    return { ok: true, reservation: toView(updated) };
  }

  /**
   * Expires the active reservations that are due at `now` (`expires_at <= now`): lowers `reserved`, marks them
   * `expired`, writes no journal row. `now` is an argument (the scheduler passes the clock), so it can be tested and
   * replayed. Each reservation is its own transaction, so one slow lock or one damaged row does not hold up the rest.
   */
  async expireDue(now: Date, options: ExpireDueOptions = {}): Promise<ExpireDueResult> {
    assertValidDate(now, "now");
    const limit = options.limit ?? DEFAULT_EXPIRE_BATCH;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPIRE_BATCH) {
      throw new RangeError(`limit must be a whole number from 1 to ${MAX_EXPIRE_BATCH}`);
    }
    if (options.after !== undefined) {
      assertValidCursor(options.after);
    }
    const due = await this.reservations.listDue(this.database, now, limit, options.after);
    const last = due.at(-1);
    const result: ExpireDueResult = {
      scanned: due.length,
      expired: 0,
      skipped: 0,
      failures: [],
      nextCursor: due.length === limit && last !== undefined ? last : null,
    };
    for (const { id: reservationId } of due) {
      const outcome = await this.expireOne(reservationId, now);
      if (outcome === "expired") {
        result.expired += 1;
      } else if (outcome === "skipped") {
        result.skipped += 1;
      } else {
        result.failures.push({ reservationId, reason: outcome });
      }
    }
    return result;
  }

  private async expireOne(
    reservationId: string,
    now: Date,
  ): Promise<"expired" | "skipped" | ReservationRefusal> {
    return withTransaction(this.database, async (tx) => {
      const locked = await this.lockPair(tx, reservationId);
      // Re-checked under the locks: a commit or a release may have finished since the list was read.
      if (
        locked === undefined ||
        locked.reservation.status !== "active" ||
        locked.reservation.expiresAt.getTime() > now.getTime()
      ) {
        return "skipped";
      }
      const decision = decideExpire(toLevel(locked.level), toHeld(locked.reservation));
      if (!decision.ok) {
        return decision.reason;
      }
      await this.apply(tx, locked.reservation, decision.level, "expired");
      return "expired";
    });
  }

  /**
   * The ONE implementation of "hold stock", for one line (`reserve`) or many (`reserveMany`), in the caller's
   * transaction. Passes, each in id order: product rows `FOR SHARE`, variant rows `FOR SHARE` (with the facts the
   * sellable rule needs), then, for the lines that can still be held, level rows `FOR UPDATE` by (variant, location).
   * Every line is evaluated against the locked rows before the first write. The level pass and the writes run in a
   * savepoint, so when any line is refused everything done there (a created empty level row included) is undone and
   * nothing is written; the locks of the product and variant passes stay until the caller's transaction ends.
   */
  private async reserveLines(
    tx: Transaction,
    lines: readonly LineRequest[],
    hold: { expiresAt: Date; reference: string | null },
  ): Promise<LineOutcome[]> {
    const outcomes: LineOutcome[] = lines.map(() => ({ kind: "not_reserved" }));
    const variantIds = [...new Set(lines.map((line) => line.variantId))];

    const productIds = await this.reservations.findProductIdsOfVariants(tx, variantIds);
    if (productIds.size > 0) {
      await this.reservations.lockProductsShared(tx, [...new Set(productIds.values())]);
    }
    const found = await this.reservations.findVariantsForReservation(
      tx,
      variantIds,
      this.pricing.shopCurrency,
    );
    const factsById = new Map(found.map((row) => [row.id, row]));

    const locations = new LocationCache(this.inventory, tx);
    const candidates: Candidate[] = [];
    for (const [index, line] of lines.entries()) {
      const variant = factsById.get(line.variantId.toLowerCase());
      if (variant === undefined) {
        outcomes[index] = { kind: "refused", reason: "variant_not_found" };
        continue;
      }
      if (productIds.get(variant.id) !== variant.productId) {
        throw new Error(`Variant ${variant.id} changed its product while it was being reserved.`);
      }
      // The same rule the store lists by (core `isVariantSellable`): a line the shop never showed is not reservable.
      const sellable = isVariantSellable({
        productStatus: productStatusSchema.parse(variant.productStatus),
        variantIsActive: variant.isActive,
        hasShopPrice: variant.hasShopPrice,
      });
      if (!sellable) {
        outcomes[index] = { kind: "refused", reason: "variant_not_sellable" };
        continue;
      }
      const flags = {
        trackInventory: variant.trackInventory,
        allowBackorder: variant.allowBackorder,
      };
      // The refusals that do not depend on the level (a bad quantity, an untracked variant) come first, so they never
      // touch a row. Only "insufficient_stock" of an empty level is expected here and is decided again below.
      const probe = decideReserve({ onHand: 0, reserved: 0 }, flags, line.quantity);
      if (!probe.ok && probe.reason !== "insufficient_stock") {
        outcomes[index] =
          probe.reason === "not_tracked"
            ? { kind: "untracked" }
            : { kind: "refused", reason: probe.reason };
        continue;
      }
      const location = await locations.get(line.locationId);
      if (location === undefined) {
        outcomes[index] = { kind: "refused", reason: "location_not_found" };
        continue;
      }
      candidates.push({ index, line, variant, flags, locationId: location.id });
    }
    if (candidates.length === 0) {
      return outcomes;
    }

    // Level locks in (variant id, location id) order: the sorted pass that keeps crossing carts from deadlocking.
    const sorted = [...candidates].sort(
      (a, b) => compareText(a.variant.id, b.variant.id) || compareText(a.locationId, b.locationId),
    );
    try {
      await tx.transaction(async (savepoint) => {
        const decided: { candidate: Candidate; level: StockLevel }[] = [];
        let refused = hasRefusal(outcomes);
        for (const candidate of sorted) {
          const { variant, line, flags, locationId } = candidate;
          let row = await this.inventory.lockLevel(savepoint, variant.id, locationId);
          if (row === undefined) {
            if (!flags.allowBackorder) {
              // No level row means nothing on hand: refuse without creating an empty row.
              outcomes[candidate.index] = { kind: "refused", reason: "insufficient_stock" };
              refused = true;
              continue;
            }
            // Parallel first reservations: one insert wins, the others do nothing, and all of them then lock the row.
            await this.inventory.insertEmptyLevel(savepoint, variant.id, locationId);
            row = await this.inventory.lockLevel(savepoint, variant.id, locationId);
          }
          if (row === undefined) {
            throw new Error("The inventory level row vanished after it was created.");
          }
          const decision = decideReserve(toLevel(row), flags, line.quantity);
          if (!decision.ok) {
            outcomes[candidate.index] = { kind: "refused", reason: decision.reason };
            refused = true;
            continue;
          }
          decided.push({ candidate, level: decision.level });
        }
        if (refused) {
          throw new HoldRefused();
        }
        for (const { candidate, level } of decided) {
          await this.inventory.updateLevel(
            savepoint,
            candidate.variant.id,
            candidate.locationId,
            level,
          );
        }
        // Inserted in input order, so the rows read like the order.
        decided.sort((a, b) => a.candidate.index - b.candidate.index);
        for (const { candidate } of decided) {
          const created = await this.reservations.insert(savepoint, {
            variantId: candidate.variant.id,
            locationId: candidate.locationId,
            quantity: candidate.line.quantity,
            expiresAt: hold.expiresAt,
            reference: hold.reference,
          });
          outcomes[candidate.index] = { kind: "reserved", reservation: toView(created) };
        }
      });
    } catch (error) {
      if (!(error instanceof HoldRefused)) {
        throw error;
      }
    }
    return outcomes;
  }

  /**
   * Locks the level row, then the reservation row, and returns both as they are under the locks (the status read
   * before the lock may be stale). `undefined` when the reservation does not exist (or went with its variant).
   */
  private async lockPair(
    tx: Transaction,
    reservationId: string,
  ): Promise<{ level: LevelRow; reservation: ReservationRow } | undefined> {
    const probe = await this.reservations.find(tx, reservationId);
    if (probe === undefined) {
      return undefined;
    }
    const level = await this.inventory.lockLevel(tx, probe.variantId, probe.locationId);
    if (level === undefined) {
      // The variant (and with it the level and the reservation) was deleted between the two reads.
      if ((await this.reservations.find(tx, reservationId)) === undefined) {
        return undefined;
      }
      throw new Error(`Reservation ${reservationId} has no inventory level row.`);
    }
    const reservation = await this.reservations.lock(tx, reservationId);
    return reservation === undefined ? undefined : { level, reservation };
  }

  private async apply(
    tx: DbExecutor,
    reservation: ReservationRow,
    level: StockLevel,
    status: "committed" | "released" | "expired",
  ): Promise<{ ok: true; reservation: ReservationView }> {
    await this.inventory.updateLevel(tx, reservation.variantId, reservation.locationId, level);
    const updated = await this.reservations.setStatus(tx, reservation.id, status);
    return { ok: true, reservation: toView(updated) };
  }
}

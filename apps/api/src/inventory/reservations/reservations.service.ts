import { Inject, Injectable } from "@nestjs/common";
import {
  assertValidStatus,
  decideCommit,
  decideExpire,
  decideRelease,
  decideReserve,
  isVariantSellable,
  type ReservationStatus,
  type StockLevel,
  type StockReservation,
} from "@fluxkit/core";
import { productStatusSchema } from "../../catalog/admin/products/products.schemas.js";
import { PRICING_CONFIG, type PricingConfig } from "../../common/pricing-config.js";
import { withTransaction, type DbExecutor, type Transaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { InventoryRepository, type LevelRow } from "../inventory.repository.js";
import {
  ReservationsRepository,
  type DueCursor,
  type ReservationRow,
} from "./reservations.repository.js";

/*
 * The reservation domain service (docs/api/inventory.md, ADR 0011). It has no HTTP route: the checkout plan calls it.
 *
 * Every operation is one transaction that takes the `inventory_level` row lock first (`SELECT ... FOR UPDATE`), then,
 * when it works on an existing reservation, the reservation row lock; it asks the core decision (`decideReserve`,
 * `decideRelease`, `decideExpire`, `decideCommit`) and writes what the decision says: the level, the reservation
 * status, and, for a commit only, the `sale` journal row. Nothing here decides a stock rule, reads the clock, or
 * updates or deletes a journal row. Refusals are returned as typed results (not thrown) so the caller can act on
 * them; bugs and damaged data throw.
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

@Injectable()
export class ReservationsService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly reservations: ReservationsRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  /**
   * Holds `quantity` units of a variant at a location. Refuses (writing nothing) when the quantity is not usable, the
   * variant is not tracked, inactive or in an unpublished product, or the available units do not cover it. With
   * `allow_backorder` it holds beyond `on_hand`. The first reservation of a backordered variant creates its level row.
   */
  async reserve(input: ReserveInput): Promise<ReserveResult> {
    assertValidDate(input.expiresAt, "expiresAt");
    return withTransaction(this.database, async (tx) => {
      const variant = await this.reservations.findVariantForReservation(
        tx,
        input.variantId,
        this.pricing.shopCurrency,
      );
      if (variant === undefined) {
        return { ok: false, reason: "variant_not_found" };
      }
      // The same rule the store lists by (core `isVariantSellable`): a line the shop never showed is not reservable.
      const sellable = isVariantSellable({
        productStatus: productStatusSchema.parse(variant.productStatus),
        variantIsActive: variant.isActive,
        hasShopPrice: variant.hasShopPrice,
      });
      if (!sellable) {
        return { ok: false, reason: "variant_not_sellable" };
      }
      const flags = {
        trackInventory: variant.trackInventory,
        allowBackorder: variant.allowBackorder,
      };
      // The refusals that do not depend on the level (a bad quantity, an untracked variant) come first, so they never
      // touch a row. Only "insufficient_stock" of an empty level is expected here and is decided again below.
      const probe = decideReserve({ onHand: 0, reserved: 0 }, flags, input.quantity);
      if (!probe.ok && probe.reason !== "insufficient_stock") {
        return probe;
      }

      const location =
        input.locationId === undefined
          ? await this.inventory.findDefaultLocation(tx)
          : await this.inventory.findLocation(tx, input.locationId);
      if (location === undefined) {
        if (input.locationId === undefined) {
          throw new Error("There is no default location; the migration creates one named main.");
        }
        return { ok: false, reason: "location_not_found" };
      }

      let row = await this.inventory.lockLevel(tx, variant.id, location.id);
      if (row === undefined) {
        if (!flags.allowBackorder) {
          // No level row means nothing on hand: refuse without creating an empty row.
          return { ok: false, reason: "insufficient_stock" };
        }
        // Parallel first reservations: one insert wins, the others do nothing, and all of them then lock the same row.
        await this.inventory.insertEmptyLevel(tx, variant.id, location.id);
        row = await this.inventory.lockLevel(tx, variant.id, location.id);
      }
      if (row === undefined) {
        throw new Error("The inventory level row vanished after it was created.");
      }

      const decision = decideReserve(toLevel(row), flags, input.quantity);
      if (!decision.ok) {
        return decision;
      }
      await this.inventory.updateLevel(tx, variant.id, location.id, decision.level);
      const created = await this.reservations.insert(tx, {
        variantId: variant.id,
        locationId: location.id,
        quantity: input.quantity,
        expiresAt: input.expiresAt,
        reference: input.reference ?? null,
      });
      return { ok: true, reservation: toView(created) };
    });
  }

  /** Gives the held units back (a cancelled cart or order). Lowers `reserved`; writes no journal row. */
  async release(reservationId: string): Promise<ReservationResult> {
    return withTransaction(this.database, async (tx) => {
      const locked = await this.lockPair(tx, reservationId);
      if (locked === undefined) {
        return { ok: false, reason: "reservation_not_found" };
      }
      const decision = decideRelease(toLevel(locked.level), toHeld(locked.reservation));
      if (!decision.ok) {
        return { ok: false, reason: decision.reason };
      }
      return this.apply(tx, locked.reservation, decision.level, "released");
    });
  }

  /**
   * Turns an active reservation into a sale: lowers `on_hand` and `reserved` and appends the `sale` movement. The
   * expiry time is not checked: a reservation that is overdue but not yet swept by `expireDue` can still be sold
   * (the customer paid); after the sweep it answers `not_active`. Backordered units that are not on hand yet answer
   * `insufficient_stock` and the reservation stays active.
   */
  async commit(reservationId: string, options: CommitOptions = {}): Promise<CommitResult> {
    return withTransaction(this.database, async (tx) => {
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
    });
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

import { describe, expect, it } from "vitest";
import { MAX_QUANTITY } from "../pricing/limits.js";
import { availabilityOf } from "./availability.js";
import type { Availability } from "./availability.js";
import {
  decideAdjustment,
  decideCommit,
  decideExpire,
  decideRelease,
  decideReserve,
} from "./decisions.js";
import type { ReservationStatus, StockFlags, StockLevel, StockMovementKind } from "./types.js";

/*
 * Property-style tests. Everything random comes from a seeded generator (never Math.random), so a failure
 * reproduces exactly. The model below is written differently from production: it keeps the list of reservations and
 * the movement journal and derives on-hand and reserved from them (a sum of journal deltas and a sum of active
 * reservation quantities), while production updates two counters.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Random {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Integer in [low, high], both inclusive. */
  int(low: number, high: number): number {
    return low + Math.floor(this.next() * (high - low + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

interface ModelReservation {
  readonly quantity: number;
  status: ReservationStatus;
}

interface Journal {
  readonly kind: StockMovementKind;
  readonly delta: number;
  readonly onHandAfter: number;
}

/** Independent availability: derived from the model, not from `availabilityOf`. */
function referenceAvailability(
  flags: StockFlags,
  onHand: number,
  reserved: number,
  threshold: number,
): Availability {
  if (!flags.trackInventory || flags.allowBackorder) {
    return "in_stock";
  }
  const free = onHand > reserved ? onHand - reserved : 0;
  if (free === 0) {
    return "out_of_stock";
  }
  return free <= threshold ? "low_stock" : "in_stock";
}

function runSequence(seed: number, steps: number): void {
  const random = new Random(seed);
  const flags: StockFlags = {
    trackInventory: true,
    allowBackorder: random.chance(0.4),
  };
  const threshold = random.int(0, 8);
  const reservations: ModelReservation[] = [];
  const journal: Journal[] = [];
  let level: StockLevel = { onHand: 0, reserved: 0 };

  const context = (step: number, operation: string) => `seed ${seed} step ${step} (${operation})`;

  for (let step = 0; step < steps; step += 1) {
    const operation = random.int(0, 5);
    const pickIndex = reservations.length === 0 ? -1 : random.int(0, reservations.length - 1);
    const picked = pickIndex === -1 ? undefined : reservations[pickIndex];

    if (operation === 0) {
      const quantity = random.int(1, 6);
      const expectedOk = flags.allowBackorder || quantity <= level.onHand - level.reserved;
      const result = decideReserve(level, flags, quantity);
      expect(result.ok, context(step, "reserve")).toBe(expectedOk);
      if (result.ok) {
        level = result.level;
        reservations.push({ quantity, status: "active" });
        expect(result.movement).toBeNull();
        expect(result.reservationStatus).toBe("active");
      }
    } else if (operation === 1 || operation === 2) {
      const decide = operation === 1 ? decideRelease : decideExpire;
      if (picked !== undefined) {
        const result = decide(level, { quantity: picked.quantity, status: picked.status });
        expect(result.ok, context(step, "release or expire")).toBe(picked.status === "active");
        if (result.ok) {
          level = result.level;
          picked.status = result.reservationStatus;
          expect(result.movement).toBeNull();
        }
      }
    } else if (operation === 3) {
      if (picked !== undefined) {
        const result = decideCommit(level, { quantity: picked.quantity, status: picked.status });
        const expectedOk = picked.status === "active" && picked.quantity <= level.onHand;
        expect(result.ok, context(step, "commit")).toBe(expectedOk);
        if (result.ok) {
          level = result.level;
          picked.status = result.reservationStatus;
          expect(result.movement).toEqual({
            kind: "sale",
            delta: -picked.quantity,
            onHandAfter: level.onHand,
          });
          journal.push(result.movement as Journal);
        }
      }
    } else if (operation === 4) {
      const delta = random.int(-8, 12);
      const kind: StockMovementKind = delta > 0 && random.chance(0.5) ? "receipt" : "adjustment";
      const result = decideAdjustment(level, { mode: "delta", delta, kind });
      const target = level.onHand + delta;
      const expectedOk = delta !== 0 && target >= level.reserved;
      expect(result.ok, context(step, "adjust delta")).toBe(expectedOk);
      if (result.ok) {
        level = result.level;
        journal.push(result.movement);
      }
    } else {
      const onHand = random.int(0, 15);
      const result = decideAdjustment(level, { mode: "setOnHand", onHand, kind: "adjustment" });
      const expectedOk = onHand !== level.onHand && onHand >= level.reserved;
      expect(result.ok, context(step, "adjust set")).toBe(expectedOk);
      if (result.ok) {
        level = result.level;
        journal.push(result.movement);
      }
    }

    const activeQuantity = reservations
      .filter((reservation) => reservation.status === "active")
      .reduce((sum, reservation) => sum + reservation.quantity, 0);
    const journalSum = journal.reduce((sum, row) => sum + row.delta, 0);

    expect(level.onHand, context(step, "on hand not negative")).toBeGreaterThanOrEqual(0);
    expect(level.reserved, context(step, "reserved not negative")).toBeGreaterThanOrEqual(0);
    if (!flags.allowBackorder) {
      expect(level.reserved, context(step, "reserved <= on hand")).toBeLessThanOrEqual(
        level.onHand,
      );
    }
    expect(level.onHand, context(step, "on hand equals the journal sum")).toBe(journalSum);
    expect(level.reserved, context(step, "reserved equals active reservations")).toBe(
      activeQuantity,
    );
    const last = journal[journal.length - 1];
    if (last !== undefined) {
      expect(last.onHandAfter, context(step, "on_hand_after of the last movement")).toBe(
        level.onHand,
      );
    }
    expect(availabilityOf(flags, [level], threshold), context(step, "availability")).toBe(
      referenceAvailability(flags, journalSum, activeQuantity, threshold),
    );
  }

  let running = 0;
  for (const row of journal) {
    running += row.delta;
    expect(row.delta, `seed ${seed}: journal delta`).not.toBe(0);
    expect(row.onHandAfter, `seed ${seed}: on_hand_after is the running sum`).toBe(running);
  }
}

describe("stock decisions: random operation sequences", () => {
  it("keep the invariants over 400 seeded sequences of 120 operations", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      runSequence(seed, 120);
    }
  });

  it("refuses a quantity above the per-line limit even with backorder", () => {
    const flags: StockFlags = { trackInventory: true, allowBackorder: true };
    expect(decideReserve({ onHand: 0, reserved: 0 }, flags, MAX_QUANTITY + 1).ok).toBe(false);
  });
});

describe("availability over many random multi-location inputs", () => {
  it("matches an independent reference", () => {
    const random = new Random(20261016);
    for (let round = 0; round < 5000; round += 1) {
      const flags: StockFlags = {
        trackInventory: random.chance(0.8),
        allowBackorder: random.chance(0.3),
      };
      const levels = Array.from({ length: random.int(0, 4) }, () => ({
        onHand: random.int(0, 20),
        reserved: random.int(0, 25),
      }));
      const threshold = random.int(0, 12);
      let free = 0;
      for (const { onHand, reserved } of levels) {
        free += Math.max(0, onHand - reserved);
      }
      let expected: Availability;
      if (!flags.trackInventory || flags.allowBackorder) {
        expected = "in_stock";
      } else if (free === 0) {
        expected = "out_of_stock";
      } else {
        expected = free <= threshold ? "low_stock" : "in_stock";
      }
      expect(availabilityOf(flags, levels, threshold), `round ${round}`).toBe(expected);
    }
  });
});

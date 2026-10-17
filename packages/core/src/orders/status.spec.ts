import { describe, expect, it } from "vitest";
import {
  ORDER_ACTORS,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  decideTransition,
  isTerminalStatus,
  stockEffectOf,
} from "./status.js";
import type { OrderActor, OrderStatus, StockEffect } from "./status.js";

/*
 * The expected table is typed out here from the plan (docs/plans/2026-10-17-cart-and-orders.md, "Statuses") as a plain
 * literal, not derived from the production table, so a wrong edit of either side fails the test.
 */
type Start = OrderStatus | "(new)";
const START_STATES: readonly Start[] = ["(new)", ...ORDER_STATUSES];

const PLAN: Readonly<Record<string, { actors: readonly OrderActor[]; effect: StockEffect }>> = {
  "(new)>awaiting_payment": { actors: ["customer", "guest"], effect: "reserve" },
  "awaiting_payment>paid": { actors: ["admin", "system"], effect: "commit" },
  "awaiting_payment>cancelled": { actors: ["customer", "guest", "admin"], effect: "release" },
  "awaiting_payment>expired": { actors: ["system"], effect: "release" },
  "paid>fulfilled": { actors: ["admin", "system"], effect: "commit" },
  "paid>cancelled": { actors: ["admin"], effect: "release_unsold" },
};

const asStatus = (start: Start): OrderStatus | null => (start === "(new)" ? null : start);

describe("the status vocabulary", () => {
  it("has the five statuses and four actors of the plan", () => {
    expect([...ORDER_STATUSES]).toEqual([
      "awaiting_payment",
      "paid",
      "fulfilled",
      "cancelled",
      "expired",
    ]);
    expect([...ORDER_ACTORS]).toEqual(["customer", "guest", "admin", "system"]);
    expect(Object.isFrozen(ORDER_STATUSES)).toBe(true);
    expect(Object.isFrozen(ORDER_ACTORS)).toBe(true);
  });

  it("fulfilled, cancelled and expired are terminal, the others are not", () => {
    expect(ORDER_STATUSES.filter((status) => isTerminalStatus(status))).toEqual([
      "fulfilled",
      "cancelled",
      "expired",
    ]);
  });

  it("an unknown status is a bug (RangeError)", () => {
    expect(() => isTerminalStatus("shipped" as OrderStatus)).toThrow(RangeError);
  });
});

describe("the transition table as data", () => {
  it("has exactly the rows of the plan, each with its actors and stock effect", () => {
    const actual = Object.fromEntries(
      ORDER_TRANSITIONS.map((rule) => [
        `${rule.from ?? "(new)"}>${rule.to}`,
        { actors: [...rule.actors], effect: rule.stockEffect },
      ]),
    );
    expect(actual).toEqual(PLAN);
    expect(ORDER_TRANSITIONS).toHaveLength(Object.keys(PLAN).length);
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(ORDER_TRANSITIONS)).toBe(true);
    for (const rule of ORDER_TRANSITIONS) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule.actors)).toBe(true);
    }
  });

  it("never leaves a terminal status", () => {
    for (const rule of ORDER_TRANSITIONS) {
      if (rule.from !== null) {
        expect(isTerminalStatus(rule.from), `${rule.from}>${rule.to}`).toBe(false);
      }
    }
  });
});

describe("decideTransition over the whole matrix (start state x target x actor)", () => {
  const cases = START_STATES.flatMap((start) =>
    ORDER_STATUSES.flatMap((target) => ORDER_ACTORS.map((actor) => ({ start, target, actor }))),
  );

  it("covers 6 x 5 x 4 = 120 combinations", () => {
    expect(cases).toHaveLength(120);
  });

  it.each(cases)("$start > $target by $actor", ({ start, target, actor }) => {
    const rule = PLAN[`${start}>${target}`];
    const decision = decideTransition(asStatus(start), target, actor);
    if (rule === undefined) {
      expect(decision).toEqual({ ok: false, reason: "invalid_transition" });
    } else if (rule.actors.includes(actor)) {
      expect(decision).toEqual({
        ok: true,
        from: asStatus(start),
        to: target,
        stockEffect: rule.effect,
      });
    } else {
      expect(decision).toEqual({ ok: false, reason: "not_allowed_for_actor" });
    }
  });

  it("a pair that is not in the table is invalid whoever asks, even an admin or the system", () => {
    for (const actor of ORDER_ACTORS) {
      expect(decideTransition("fulfilled", "paid", actor)).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(decideTransition("cancelled", "paid", actor)).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(decideTransition("paid", "awaiting_payment", actor)).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(decideTransition("paid", "paid", actor)).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
      expect(decideTransition(null, "paid", actor)).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
    }
  });

  it("a customer can cancel only before payment; only the system expires; only an admin cancels a paid order", () => {
    expect(decideTransition("awaiting_payment", "cancelled", "customer").ok).toBe(true);
    expect(decideTransition("awaiting_payment", "cancelled", "guest").ok).toBe(true);
    expect(decideTransition("paid", "cancelled", "customer")).toEqual({
      ok: false,
      reason: "not_allowed_for_actor",
    });
    expect(decideTransition("paid", "cancelled", "guest")).toEqual({
      ok: false,
      reason: "not_allowed_for_actor",
    });
    expect(decideTransition("paid", "cancelled", "system")).toEqual({
      ok: false,
      reason: "not_allowed_for_actor",
    });
    expect(decideTransition("paid", "cancelled", "admin").ok).toBe(true);
    for (const actor of ["customer", "guest", "admin"] as const) {
      expect(decideTransition("awaiting_payment", "expired", actor)).toEqual({
        ok: false,
        reason: "not_allowed_for_actor",
      });
    }
    expect(decideTransition("awaiting_payment", "expired", "system").ok).toBe(true);
  });

  it("a customer or guest can not mark an order paid or fulfilled", () => {
    for (const actor of ["customer", "guest"] as const) {
      expect(decideTransition("awaiting_payment", "paid", actor).ok).toBe(false);
      expect(decideTransition("paid", "fulfilled", actor).ok).toBe(false);
    }
  });

  it("treats unknown statuses, actors and a missing target as bugs (RangeError)", () => {
    expect(() => decideTransition("shipped" as OrderStatus, "paid", "admin")).toThrow(RangeError);
    expect(() => decideTransition("paid", "shipped" as OrderStatus, "admin")).toThrow(RangeError);
    expect(() => decideTransition("paid", "fulfilled", "root" as OrderActor)).toThrow(RangeError);
    expect(() => decideTransition("paid", null as unknown as OrderStatus, "admin")).toThrow(
      RangeError,
    );
    expect(() => decideTransition(undefined as unknown as null, "paid", "admin")).toThrow(
      RangeError,
    );
    expect(() => decideTransition("__proto__" as OrderStatus, "paid", "admin")).toThrow(RangeError);
  });

  it("returns a frozen decision", () => {
    expect(Object.isFrozen(decideTransition("awaiting_payment", "paid", "admin"))).toBe(true);
    expect(Object.isFrozen(decideTransition("paid", "paid", "admin"))).toBe(true);
  });
});

describe("stockEffectOf", () => {
  it("gives the stock effect of every transition in the table", () => {
    for (const [key, rule] of Object.entries(PLAN)) {
      const [from, to] = key.split(">") as [Start, OrderStatus];
      expect(stockEffectOf(asStatus(from), to), key).toBe(rule.effect);
    }
  });

  it("cancelling a paid order releases only what is still unsold (ADR 0022), no other transition does", () => {
    expect(stockEffectOf("paid", "cancelled")).toBe("release_unsold");
    expect(
      ORDER_TRANSITIONS.filter((entry) => entry.stockEffect === "release_unsold").map(
        (entry) => `${String(entry.from)}>${entry.to}`,
      ),
    ).toEqual(["paid>cancelled"]);
  });

  it("refuses to guess for a pair that is not in the table (RangeError)", () => {
    expect(() => stockEffectOf("paid", "awaiting_payment")).toThrow(RangeError);
    expect(() => stockEffectOf("cancelled", "cancelled")).toThrow(RangeError);
    expect(() => stockEffectOf(null, "paid")).toThrow(RangeError);
  });

  it("matches decideTransition for every pair the table allows", () => {
    for (const start of START_STATES) {
      for (const target of ORDER_STATUSES) {
        const rule = PLAN[`${start}>${target}`];
        if (rule === undefined) continue;
        const decision = decideTransition(asStatus(start), target, rule.actors[0] ?? "admin");
        expect(decision.ok && decision.stockEffect).toBe(rule.effect);
      }
    }
  });
});

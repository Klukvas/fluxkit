import { NetworkError, type AdminResult, type AdminRole } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWrite } from "../../../lib/run-write";
import { createFormWriter } from "../../catalog-dictionaries/use-form-submit";
import type { PricePlan } from "../prices/price-grid";
import { newAdjustmentValues, planAdjustment, type AdjustmentValues } from "./stock-adjustment";
import {
  priceControls,
  runAdjustment,
  savePrices,
  stockSections,
  submitAdjustment,
  type AdjustmentSubmit,
  type PriceSave,
} from "./stock-access";

const permissionsOf = (role: AdminRole) => [...ROLE_PERMISSIONS[role]];

describe("stockSections (what the Stock tab shows, from the session's permissions only)", () => {
  it("gives the viewer the levels and the journal only: no form, no reservations, no users list", () => {
    expect(stockSections(permissionsOf("viewer"))).toEqual({
      adjust: false,
      reservations: false,
      userEmails: false,
    });
  });

  it("gives the manager the form and the reservations (orders.read), not the users list", () => {
    expect(stockSections(permissionsOf("manager"))).toEqual({
      adjust: true,
      reservations: true,
      userEmails: false,
    });
  });

  it("gives the owner everything, the emails of the journal's admins included", () => {
    expect(stockSections(permissionsOf("owner"))).toEqual({
      adjust: true,
      reservations: true,
      userEmails: true,
    });
  });

  it("hides the reservations from a session with catalog rights but without orders.read", () => {
    expect(stockSections(["catalog.read", "catalog.write", "catalog.publish"]).reservations).toBe(
      false,
    );
    expect(stockSections(null)).toEqual({ adjust: false, reservations: false, userEmails: false });
  });
});

describe("priceControls", () => {
  it("lets the manager and the owner edit and remove prices, the viewer neither", () => {
    expect(priceControls(permissionsOf("viewer"))).toEqual({ write: false, remove: false });
    expect(priceControls(permissionsOf("manager"))).toEqual({ write: true, remove: true });
    expect(priceControls(permissionsOf("owner"))).toEqual({ write: true, remove: true });
  });
});

describe("runAdjustment (owner answer 12: sent once, never retried; levels and journal read again after ANY answer)", () => {
  function counting(answer: () => Promise<AdminResult<{ id: string }>>) {
    const calls = { write: 0, reload: 0 };
    const write = async () => {
      calls.write += 1;
      return answer();
    };
    const reload = () => {
      calls.reload += 1;
    };
    return { calls, write, reload };
  }

  it("an accepted change: one request, then a reload", async () => {
    const run = counting(async () => ({ ok: true, status: 201, data: { id: "m1" } }));
    const outcome = await runAdjustment(runWrite, run.write, run.reload);
    expect(outcome.kind).toBe("ok");
    expect(run.calls).toEqual({ write: 1, reload: 1 });
  });

  it("a refused change (below_reserved): one request, then a reload, no second try", async () => {
    const run = counting(async () => ({
      ok: false,
      status: 409,
      retryAfter: null,
      problem: {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "rule_violation",
        rule: "below_reserved",
        detail: "x",
      },
    }));
    const outcome = await runAdjustment(runWrite, run.write, run.reload);
    expect(outcome.kind).toBe("problem");
    expect(run.calls).toEqual({ write: 1, reload: 1 });
  });

  it("a lost answer (network): one request, never repeated, then a reload so the journal shows whether it landed", async () => {
    const run = counting(async () => {
      throw new NetworkError("down", { cause: new Error("reset"), aborted: false });
    });
    const outcome = await runAdjustment(runWrite, run.write, run.reload);
    expect(outcome.kind).toBe("unknown");
    expect(run.calls).toEqual({ write: 1, reload: 1 });
  });

  it("a screen that went away (abort): nothing to reload", async () => {
    const run = counting(async () => {
      throw new NetworkError("aborted", { cause: new Error("abort"), aborted: true });
    });
    const outcome = await runAdjustment(runWrite, run.write, run.reload);
    expect(outcome.kind).toBe("aborted");
    expect(run.calls).toEqual({ write: 1, reload: 0 });
  });
});

describe("submitAdjustment (the Stock tab's submit, step 13 review G07)", () => {
  const values = (overrides: Partial<AdjustmentValues>): AdjustmentValues => ({
    ...newAdjustmentValues("loc"),
    ...overrides,
  });
  const receipt = () =>
    planAdjustment(values({ quantity: "5" }), { onHand: 3, reserved: 0 }, { locationCount: 1 });

  function run(overrides: Partial<AdjustmentSubmit>) {
    const log: string[] = [];
    submitAdjustment({
      writing: false,
      busy: false,
      waiting: false,
      plan: () => {
        log.push("plan");
        return receipt();
      },
      showIssues: () => log.push("issues"),
      clearResult: () => log.push("clear"),
      confirm: () => log.push("confirm"),
      send: () => log.push("send"),
      ...overrides,
    });
    return log;
  }

  it("sends a valid adjustment that needs no confirmation", () => {
    expect(receipt().ok).toBe(true);
    expect(run({})).toEqual(["plan", "clear", "send"]);
  });

  it("sends nothing and changes nothing while a write runs, while busy, or while the newest movement loads", () => {
    expect(run({ writing: true })).toEqual([]);
    expect(run({ busy: true })).toEqual([]);
    expect(run({ waiting: true })).toEqual([]);
  });

  it("shows local issues without sending, and asks before a change that needs a confirmation", () => {
    expect(
      run({
        plan: () => planAdjustment(values({}), { onHand: 3, reserved: 0 }, { locationCount: 1 }),
      }),
    ).toEqual(["issues"]);
    const lowering = planAdjustment(
      values({ kind: "adjustment", mode: "setOnHand", quantity: "1" }),
      { onHand: 5, reserved: 0 },
      { locationCount: 1 },
    );
    expect(lowering.ok && lowering.confirm !== null).toBe(true);
    expect(run({ plan: () => lowering })).toEqual(["clear", "confirm"]);
  });
});

describe("savePrices (the Prices tab's bulk save, step 13 review G06)", () => {
  const planned: PricePlan = {
    ok: true,
    items: [
      {
        key: "v1:UAH",
        item: { variantId: "v1", currency: "UAH", amount: 12345, compareAtAmount: null },
      },
    ],
  };
  const ok = { kind: "ok" as const, status: 200, data: undefined };

  function parts(overrides: Partial<PriceSave>, log: string[]): PriceSave {
    return {
      busy: false,
      plan: () => {
        log.push("plan");
        return planned;
      },
      showIssues: () => log.push("issues"),
      nothingChanged: () => log.push("nothing"),
      rememberSent: (keys) => log.push(`keys ${keys.join(",")}`),
      submit: () => {
        log.push("put");
        return Promise.resolve(ok);
      },
      onSaved: (count) => log.push(`saved ${String(count)}`),
      onUnknown: () => log.push("unknown"),
      ...overrides,
    };
  }

  it("sends one PUT with the changed cells and reports how many were saved", async () => {
    const log: string[] = [];
    await savePrices(parts({}, log));
    expect(log).toEqual(["plan", "keys v1:UAH", "put", "saved 1"]);
  });

  it("does nothing while a save runs: no plan, no new sent keys, no request", async () => {
    const log: string[] = [];
    await savePrices(parts({ busy: true }, log));
    expect(log).toEqual([]);
  });

  it("shows issues without sending, and sends nothing for an unchanged grid", async () => {
    const log: string[] = [];
    await savePrices(parts({ plan: () => ({ ok: false, issues: { a: "amount_required" } }) }, log));
    await savePrices(parts({ plan: () => ({ ok: true, items: [] }) }, log));
    expect(log).toEqual(["issues", "nothing"]);
  });

  it("with the form's writer: two submits in one task send one PUT", async () => {
    const writer = createFormWriter({
      setState: () => undefined,
      crash: () => undefined,
      focusSummary: () => undefined,
      fields: () => [],
      mapProblem: () => undefined,
    });
    let puts = 0;
    const log: string[] = [];
    const submit = () =>
      savePrices(
        parts(
          {
            busy: writer.pending(),
            submit: () =>
              writer.submit(() => {
                puts += 1;
                return Promise.resolve({ ok: true as const, status: 200, data: undefined });
              }),
          },
          log,
        ),
      );
    await Promise.all([submit(), submit()]);
    expect(puts).toBe(1);
    expect(log.filter((entry) => entry.startsWith("saved"))).toEqual(["saved 1"]);
  });
});

describe("the tabs call the tested submits with their guards (source guards)", () => {
  const source = (path: string) =>
    readFileSync(join(import.meta.dirname, path), "utf8").replace(
      /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
      "$1",
    );

  it("the Stock tab passes its single flight, busy state and the wait for the newest movement", () => {
    const tab = source("stock-tab.tsx");
    expect(tab).toMatch(
      /submitAdjustment\(\{\s*writing: flight\.current\.pending\(\),\s*busy,\s*waiting,/,
    );
  });

  it("the Prices tab passes the form's busy state and its single flight", () => {
    const tab = source("../prices/prices-tab.tsx");
    expect(tab).toMatch(/savePrices\(\{\s*busy: form\.state\.busy \|\| form\.pending\(\),/);
  });
});

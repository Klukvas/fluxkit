import { NetworkError, type AdminResult, type AdminRole } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import { runWrite } from "../../../lib/run-write";
import { priceControls, runAdjustment, stockSections } from "./stock-access";

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
